import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const DB_PAGE_SIZE = 1000;

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const r = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Auvo login failed (${r.status})`);
  const j = await r.json();
  const token = j?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function isoDate(s: string | null | undefined): string | null {
  const raw = String(s || "").trim();
  if (!raw) return null;
  const d = raw.split("T")[0];
  if (!d || d === "0001-01-01") return null;
  return d;
}

function isoTimestamp(s: string | null | undefined): string | null {
  const raw = String(s || "").trim();
  if (!raw) return null;
  if (raw.startsWith("0001-01-01")) return null;
  return raw;
}

async function fetchWithRetry(url: string, token: string, attempts = 2): Promise<Response | null> {
  let delay = 400;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { headers: authHeaders(token), signal: ctrl.signal });
      clearTimeout(tid);
      if (r.ok) return r;
      if (r.status !== 502 && r.status !== 503 && r.status !== 504) return r;
    } catch (e) {
      clearTimeout(tid);
      console.warn("fetchWithRetry attempt", i, e);
    }
    await new Promise((res) => setTimeout(res, delay));
    delay *= 2;
  }
  return null;
}

async function fetchAuvoTasks(
  token: string,
  filterObj: Record<string, unknown>,
  label: string,
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${PAGE_SIZE}&order=desc&paramFilter=${paramFilter}`;
    const r = await fetchWithRetry(url, token);
    if (!r || !r.ok) {
      console.warn(`[horas-trabalhadas-fetch:${label}] page ${page} failed (${r?.status ?? "no-response"})`);
      break;
    }
    const j = await r.json();
    const tasks = j?.result?.entityList || j?.result?.Entities || j?.result?.tasks || j?.result || [];
    if (!Array.isArray(tasks) || tasks.length === 0) break;
    all.push(...tasks);
    if (tasks.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

function mapAuvoTask(t: any) {
  const taskId = String(t?.taskID ?? t?.taskId ?? t?.id ?? "").trim();
  const taskType = t?.taskType ?? t?.TaskType ?? null;
  const status = t?.taskStatus ?? t?.TaskStatus ?? null;
  const statusLabelMap: Record<number, string> = {
    1: "Aberta", 2: "Em deslocamento", 3: "Em andamento",
    4: "Finalizada", 5: "Finalizada", 6: "Pausada",
  };
  const statusLabel = typeof status === "number" ? statusLabelMap[status] ?? "" : "";
  return {
    auvo_task_id: taskId,
    task_type_id: taskType != null ? String(taskType) : "",
    task_type_description: String(t?.taskTypeDescription || t?.TaskTypeDescription || "").trim(),
    auvo_status_label: statusLabel,
    auvo_date_last_update: isoTimestamp(t?.dateLastUpdate || t?.DateLastUpdate),
    auvo_task_date: isoDate(t?.taskDate || t?.TaskDate),
    auvo_check_in_date: isoDate(t?.checkInDate || t?.CheckInDate),
    auvo_check_out_date: isoDate(t?.checkOutDate || t?.CheckOutDate),
    check_in_iso: isoTimestamp(t?.checkInDate || t?.CheckInDate),
    check_out_iso: isoTimestamp(t?.checkOutDate || t?.CheckOutDate),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const avisos: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || "batch");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ─── Modo "single": refetch de UMA OS específica do Auvo ────────
    if (mode === "single") {
      const taskId = String(body?.taskId || "").trim();
      if (!taskId) {
        return new Response(JSON.stringify({ ok: false, error: "taskId obrigatório" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Estado anterior (para retornar diff ao cliente)
      const { data: prev } = await supabase
        .from("tarefas_central")
        .select("auvo_task_id, duracao_decimal, status_auvo, check_in_iso, check_out_iso, hora_inicio, hora_fim, data_tarefa, data_conclusao, atualizado_em")
        .eq("auvo_task_id", taskId)
        .maybeSingle();

      try {
        const apiKey = Deno.env.get("AUVO_APP_KEY");
        const apiToken = Deno.env.get("AUVO_TOKEN");
        if (!apiKey || !apiToken) throw new Error("AUVO_APP_KEY/AUVO_TOKEN ausentes");
        const token = await auvoLogin(apiKey, apiToken);

        const url = `${AUVO_BASE_URL}/tasks/${encodeURIComponent(taskId)}`;
        const r = await fetchWithRetry(url, token);
        if (!r || !r.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: `Auvo respondeu ${r?.status ?? "sem resposta"} para a OS ${taskId}` }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const j = await r.json();
        const t = j?.result?.entity || j?.result || j;
        const m = mapAuvoTask(t);
        if (!m.auvo_task_id) {
          return new Response(
            JSON.stringify({ ok: false, error: "Auvo retornou OS sem ID" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Atualiza somente os campos seguros — não toca em campos GC/financeiros
        // nem dispara qualquer reescrita de OS Em Aberto.
        const update: any = {
          task_type_id: m.task_type_id || null,
          status_auvo: m.auvo_status_label || null,
          data_tarefa: m.auvo_task_date,
          data_conclusao: m.auvo_check_out_date,
          check_in_iso: m.check_in_iso,
          check_out_iso: m.check_out_iso,
          atualizado_em: m.auvo_date_last_update || new Date().toISOString(),
        };
        // Recalcula hora_inicio / hora_fim a partir do ISO quando disponível
        if (m.check_in_iso) update.hora_inicio = String(m.check_in_iso).slice(11, 16);
        if (m.check_out_iso) update.hora_fim = String(m.check_out_iso).slice(11, 16);
        // Recalcula duracao_decimal (horas) baseado em check_in/out
        if (m.check_in_iso && m.check_out_iso) {
          const ms = new Date(m.check_out_iso).getTime() - new Date(m.check_in_iso).getTime();
          if (Number.isFinite(ms)) update.duracao_decimal = Math.round((ms / 3_600_000) * 10000) / 10000;
        }

        // Upsert restrito por auvo_task_id (mirror_key permanece como está)
        if (prev) {
          await supabase.from("tarefas_central").update(update).eq("auvo_task_id", taskId);
        } else {
          await supabase.from("tarefas_central").upsert(
            { auvo_task_id: taskId, mirror_key: taskId, ...update },
            { onConflict: "mirror_key" },
          );
        }

        const { data: nowRow } = await supabase
          .from("tarefas_central")
          .select("*")
          .eq("auvo_task_id", taskId)
          .maybeSingle();

        return new Response(JSON.stringify({
          ok: true,
          task: nowRow,
          alteracoes: {
            horas_anteriores: prev?.duracao_decimal ?? null,
            horas_atuais: nowRow?.duracao_decimal ?? null,
            status_anterior: prev?.status_auvo ?? null,
            status_atual: nowRow?.status_auvo ?? null,
          },
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: any) {
        return new Response(
          JSON.stringify({ ok: false, error: e?.message || String(e) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ─── Modo "batch" (default) ────────────────────────────────────
    const startDate = String(body?.startDate || "");
    const endDate = String(body?.endDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return new Response(JSON.stringify({ error: "startDate/endDate inválidos (yyyy-mm-dd)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Read DB tasks within period (deterministic order to avoid pagination dupes).
    const dbRows: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("*")
        .or(
          `and(data_conclusao.gte.${startDate},data_conclusao.lte.${endDate}),` +
          `and(data_conclusao.is.null,data_tarefa.gte.${startDate},data_tarefa.lte.${endDate})`
        )
        .order("data_tarefa", { ascending: false })
        .order("auvo_task_id", { ascending: false })
        .range(from, from + DB_PAGE_SIZE - 1);
      if (error) throw error;
      const batch = data || [];
      dbRows.push(...batch);
      if (batch.length < DB_PAGE_SIZE) break;
      from += DB_PAGE_SIZE;
    }

    // 2 + 3) Auvo: recently-updated since startDate AND in-progress within period.
    let auvoTasks: any[] = [];
    try {
      const apiKey = Deno.env.get("AUVO_APP_KEY");
      const apiToken = Deno.env.get("AUVO_TOKEN");
      if (!apiKey || !apiToken) throw new Error("AUVO_APP_KEY/AUVO_TOKEN ausentes");
      const token = await auvoLogin(apiKey, apiToken);

      // (a) Tasks updated since startDate (catches recently-modified historical OS)
      const recentFilter = {
        startDate: "2020-01-01T00:00:00",
        endDate: "2099-12-31T23:59:59",
        dateLastUpdate: `${startDate}T00:00:00`,
      };
      // (b) Tasks scheduled within period — catches OS that haven't been
      //     updated lately but have work in the period (e.g. open/paused).
      const periodFilter = {
        startDate: `${startDate}T00:00:00`,
        endDate: `${endDate}T23:59:59`,
      };

      const [recent, period] = await Promise.all([
        fetchAuvoTasks(token, recentFilter, "recent"),
        fetchAuvoTasks(token, periodFilter, "period"),
      ]);

      // Filter recent: drop entries whose dateLastUpdate is AFTER endDate (they
      // are post-period changes and shouldn't drive period inclusion).
      const endStamp = `${endDate}T23:59:59`;
      const recentFiltered = recent.filter((t: any) => {
        const dlu = String(t?.dateLastUpdate || t?.DateLastUpdate || "");
        return !dlu || dlu <= endStamp;
      });

      const merged = new Map<string, any>();
      for (const t of [...recentFiltered, ...period]) {
        const id = String(t?.taskID ?? t?.taskId ?? t?.id ?? "");
        if (!id) continue;
        const ex = merged.get(id);
        const dlu = String(t?.dateLastUpdate || t?.DateLastUpdate || "");
        if (!ex || dlu > String(ex?.dateLastUpdate || ex?.DateLastUpdate || "")) {
          merged.set(id, t);
        }
      }
      auvoTasks = Array.from(merged.values());
    } catch (e: any) {
      avisos.push(`Auvo indisponível — OS recentemente atualizadas podem não estar refletidas: ${e?.message || e}`);
      auvoTasks = [];
    }

    // 4) Index DB rows by id (most recent atualizado_em wins).
    const dbById = new Map<string, any>();
    for (const r of dbRows) {
      const id = String(r.auvo_task_id || "");
      if (!id) continue;
      const existing = dbById.get(id);
      if (!existing || (r.atualizado_em || "") > (existing.atualizado_em || "")) {
        dbById.set(id, r);
      }
    }

    // 5) Merge: prefer DB columns, attach Auvo-only fields (task_type_id,
    //    check_in_iso/check_out_iso). For Auvo-only rows, keep minimal record.
    const merged = new Map<string, any>();
    for (const r of dbById.values()) {
      merged.set(String(r.auvo_task_id), { ...r });
    }
    for (const t of auvoTasks) {
      const m = mapAuvoTask(t);
      if (!m.auvo_task_id) continue;
      const existing = merged.get(m.auvo_task_id);
      if (existing) {
        existing.task_type_id = m.task_type_id || existing.task_type_id || "";
        existing.task_type_description = m.task_type_description || existing.task_type_description || "";
        existing.check_in_iso = m.check_in_iso || existing.check_in_iso || null;
        existing.check_out_iso = m.check_out_iso || existing.check_out_iso || null;
        const dbStamp = String(existing.atualizado_em || "");
        const auvoStamp = String(m.auvo_date_last_update || "");
        if (auvoStamp && auvoStamp > dbStamp) {
          existing.atualizado_em = auvoStamp;
        }
      } else {
        merged.set(m.auvo_task_id, {
          auvo_task_id: m.auvo_task_id,
          task_type_id: m.task_type_id,
          task_type_description: m.task_type_description,
          status_auvo: m.auvo_status_label,
          data_tarefa: m.auvo_task_date,
          data_conclusao: m.auvo_check_out_date,
          atualizado_em: m.auvo_date_last_update,
          check_in_iso: m.check_in_iso,
          check_out_iso: m.check_out_iso,
        });
      }
    }

    const tasks = Array.from(merged.values());

    // 6) Enriquecimento: para tarefas sem vínculo GC (OS/Orçamento), buscar a
    //    tarefa "pai" (Visita técnica - Ordem de Serviço) cujo campo
    //    gc_os_tarefa_exec referencia esta tarefa de execução, e herdar os
    //    campos GC. Cobre casos onde a tarefa de execução aparece no relatório
    //    sem código GC mesmo havendo uma OS pai sincronizada.
    try {
      const orfas = tasks.filter((t: any) => {
        if (!String(t.auvo_task_id || "").trim()) return false;
        const semGc = !String(t.gc_os_codigo || "").trim() &&
                      !String(t.gc_orcamento_codigo || "").trim();
        const semEquip = !String(t.equipamento_nome || "").trim();
        return semGc || semEquip;
      });
      if (orfas.length > 0) {
        // Busca em lotes — gc_os_tarefa_exec pode conter IDs separados por barra.
        const ids = orfas.map((t: any) => String(t.auvo_task_id));
        const orFilter = ids
          .map((id) => `gc_os_tarefa_exec.ilike.%${id}%`)
          .join(",");
        const { data: parents } = await supabase
          .from("tarefas_central")
          .select(
            "auvo_task_id, gc_os_tarefa_exec, gc_os_codigo, gc_os_id, gc_os_link, " +
            "gc_os_situacao, gc_os_situacao_id, gc_os_cor_situacao, gc_os_data, " +
            "gc_os_data_saida, gc_os_valor_total, gc_os_vendedor, gc_os_cliente, " +
            "gc_orcamento_codigo, gc_orcamento_id, gc_orc_link, gc_orc_situacao, " +
            "gc_orc_situacao_id, gc_orc_cor_situacao, gc_orc_data, gc_orc_valor_total, " +
            "gc_orc_vendedor, gc_orc_cliente, equipamento_nome, equipamento_id_serie"
          )
          .or(orFilter);

        // Mapa: execId → parent row (prefere quem tem gc_os_codigo preenchido)
        const byExec = new Map<string, any>();
        for (const p of parents || []) {
          const execStr = String(p.gc_os_tarefa_exec || "");
          if (!execStr) continue;
          const execIds = execStr.split(/[\/,;\s]+/).map((x) => x.trim()).filter(Boolean);
          for (const eid of execIds) {
            const cur = byExec.get(eid);
            const score = (p.gc_os_codigo ? 2 : 0) + (p.gc_orcamento_codigo ? 1 : 0);
            const curScore = cur ? (cur.gc_os_codigo ? 2 : 0) + (cur.gc_orcamento_codigo ? 1 : 0) : -1;
            if (!cur || score > curScore) byExec.set(eid, p);
          }
        }

        let enriched = 0;
        for (const t of orfas) {
          const p = byExec.get(String(t.auvo_task_id));
          if (!p) continue;
          // Herda apenas campos GC vazios — nunca sobrescreve dados existentes.
          const fields = [
            "gc_os_codigo","gc_os_id","gc_os_link","gc_os_situacao","gc_os_situacao_id",
            "gc_os_cor_situacao","gc_os_data","gc_os_data_saida","gc_os_valor_total",
            "gc_os_vendedor","gc_os_cliente",
            "gc_orcamento_codigo","gc_orcamento_id","gc_orc_link","gc_orc_situacao",
            "gc_orc_situacao_id","gc_orc_cor_situacao","gc_orc_data","gc_orc_valor_total",
            "gc_orc_vendedor","gc_orc_cliente",
            "equipamento_nome","equipamento_id_serie",
          ];
          let touched = false;
          for (const f of fields) {
            if (!t[f] && p[f]) { t[f] = p[f]; touched = true; }
          }
          if (touched) {
            t.gc_inherited_from = p.auvo_task_id;
            enriched++;
          }
        }
        if (enriched > 0) {
          avisos.push(`${enriched} tarefa(s) de execução enriquecidas com OS/Orçamento da tarefa pai.`);
        }
      }
    } catch (e: any) {
      console.warn("[horas-trabalhadas-fetch] enrichment failed:", e?.message || e);
      avisos.push(`Falha ao enriquecer execuções com GC: ${e?.message || e}`);
    }

    // 6.b) Fallback de equipamento: para qualquer tarefa que ainda esteja sem
    //      equipamento_nome, herdar de tarefas-irmãs do mesmo cliente na mesma
    //      data (ou ±1 dia) que possuam equipamento. Concatena nomes únicos.
    try {
      const semEquip = tasks.filter((t: any) =>
        !String(t.equipamento_nome || "").trim() &&
        String(t.cliente || "").trim() &&
        String(t.data_tarefa || "").trim()
      );
      if (semEquip.length > 0) {
        const clientes = Array.from(new Set(semEquip.map((t: any) => String(t.cliente))));
        const datas = Array.from(new Set(semEquip.map((t: any) => String(t.data_tarefa).slice(0, 10))));
        // Janela ±1 dia
        const minD = datas.reduce((a, b) => (a < b ? a : b));
        const maxD = datas.reduce((a, b) => (a > b ? a : b));
        const expand = (d: string, delta: number) => {
          const dt = new Date(d + "T00:00:00Z");
          dt.setUTCDate(dt.getUTCDate() + delta);
          return dt.toISOString().slice(0, 10);
        };
        const { data: irmas } = await supabase
          .from("tarefas_central")
          .select("cliente, data_tarefa, equipamento_nome, equipamento_id_serie")
          .in("cliente", clientes)
          .gte("data_tarefa", expand(minD, -1))
          .lte("data_tarefa", expand(maxD, 1))
          .not("equipamento_nome", "is", null);

        const byKey = new Map<string, { nomes: Set<string>; series: Set<string> }>();
        for (const r of irmas || []) {
          const nome = String(r.equipamento_nome || "").trim();
          if (!nome) continue;
          const key = `${String(r.cliente)}|${String(r.data_tarefa).slice(0, 10)}`;
          if (!byKey.has(key)) byKey.set(key, { nomes: new Set(), series: new Set() });
          byKey.get(key)!.nomes.add(nome);
          const serie = String(r.equipamento_id_serie || "").trim();
          if (serie) byKey.get(key)!.series.add(serie);
        }

        let inferidos = 0;
        for (const t of semEquip) {
          const key = `${String(t.cliente)}|${String(t.data_tarefa).slice(0, 10)}`;
          let entry = byKey.get(key);
          // Se não achou no mesmo dia, tenta ±1 dia
          if (!entry) {
            const d = String(t.data_tarefa).slice(0, 10);
            for (const delta of [-1, 1]) {
              const k2 = `${String(t.cliente)}|${expand(d, delta)}`;
              if (byKey.has(k2)) { entry = byKey.get(k2); break; }
            }
          }
          if (!entry || entry.nomes.size === 0) continue;
          t.equipamento_nome = Array.from(entry.nomes).join(" / ");
          if (entry.series.size > 0) t.equipamento_id_serie = Array.from(entry.series).join(" / ");
          t.equipamento_inferido = true;
          inferidos++;
        }
        if (inferidos > 0) {
          avisos.push(`${inferidos} tarefa(s) com equipamento inferido de tarefas-irmãs do mesmo cliente/data.`);
        }
      }
    } catch (e: any) {
      console.warn("[horas-trabalhadas-fetch] equip fallback failed:", e?.message || e);
    }

    return new Response(JSON.stringify({ tasks, avisos }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || String(e), tasks: [], avisos }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
