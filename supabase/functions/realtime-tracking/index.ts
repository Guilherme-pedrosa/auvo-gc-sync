import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const GC_BASE_URL = "https://api.gestaoclick.com";

// Fetch GC docs and build a map of auvo_task_id → { codigo, valor_total }
async function fetchGcDocMap(
  gcHeaders: Record<string, string>,
  endpoint: "ordens_servicos" | "orcamentos",
  atributoId: string,
  labelHints: string[]
): Promise<Record<string, { codigo: string; valor: string }>> {
  const map: Record<string, { codigo: string; valor: string }> = {};
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 30) {
    const url = `${GC_BASE_URL}/api/${endpoint}?limite=100&pagina=${page}`;
    const response = await fetch(url, { headers: gcHeaders });
    if (!response.ok) break;
    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const doc of records) {
      const atributos: any[] = doc.atributos || [];
      const atributoTarefa = atributos.find((a: any) => {
        const nested = a?.atributo || a;
        const id = String(nested.atributo_id || nested.id || "");
        const label = String(nested.descricao || nested.label || nested.nome || "").toLowerCase();
        return id === atributoId || labelHints.some((hint) => label.includes(hint));
      });
      if (!atributoTarefa) continue;
      const nested2 = atributoTarefa?.atributo || atributoTarefa;
      const taskIdValue = String(nested2?.conteudo || nested2?.valor || "").trim();
      if (!taskIdValue || !/^\d+$/.test(taskIdValue)) continue;

      map[taskIdValue] = {
        codigo: String(doc.codigo || doc.id),
        valor: String(doc.valor_total || "0"),
      };
    }
    page++;
  }

  return map;
}

async function fetchGcOsMap(gcHeaders: Record<string, string>): Promise<Record<string, { codigo: string; valor: string }>> {
  const atributoId = Deno.env.get("GC_ATRIBUTO_TAREFA_ID") || "73344";
  const label = (Deno.env.get("AUVO_ATRIBUTO_LABEL") || "Tarefa Execução").toLowerCase();
  const map = await fetchGcDocMap(gcHeaders, "ordens_servicos", atributoId, [label, "tarefa execu"]);
  console.log(`[realtime-tracking] GC map: ${Object.keys(map).length} OS mapeadas`);
  return map;
}

async function fetchGcOrcMap(gcHeaders: Record<string, string>): Promise<Record<string, { codigo: string; valor: string }>> {
  const atributoId = Deno.env.get("GC_ATRIBUTO_ORCAMENTO_ID") || "73341";
  const label = (Deno.env.get("AUVO_ATRIBUTO_ORCAMENTO_LABEL") || "Tarefa Orçamento").toLowerCase();
  const map = await fetchGcDocMap(gcHeaders, "orcamentos", atributoId, [label, "tarefa orç", "tarefa orc", "orcamento"]);
  console.log(`[realtime-tracking] GC map: ${Object.keys(map).length} Orçamentos mapeados`);
  return map;
}

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Auvo login failed (${response.status}): ${text.substring(0, 200)}`);
  }
  const data = await response.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: accessToken não retornado");
  return token;
}

function auvoHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function fetchAllTasks(
  bearerToken: string,
  startDate: string,
  endDate: string,
  status?: number // undefined = all statuses
): Promise<any[]> {
  const allTasks: any[] = [];
  let page = 1;
  const pageSize = 100;
  const MAX_PAGES = 30;

  const filterObj: any = {
    startDate: `${startDate}T00:00:00`,
    endDate: `${endDate}T23:59:59`,
  };
  if (status !== undefined) filterObj.status = status;

  while (page <= MAX_PAGES) {
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=asc&paramFilter=${paramFilter}`;
    const response = await fetch(url, { headers: auvoHeaders(bearerToken) });

    if (response.status === 404) break;
    if (!response.ok) {
      console.error(`[realtime-tracking] Page ${page}: ${response.status}`);
      break;
    }

    const data = await response.json();
    const entities = data?.result?.entityList || data?.result?.Entities || [];
    allTasks.push(...entities);
    if (entities.length < pageSize) break;
    page++;
  }

  return allTasks;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    if (!auvoApiKey || !auvoApiToken) {
      return new Response(JSON.stringify({ error: "Credenciais Auvo não configuradas" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try { const text = await req.text(); if (text) body = JSON.parse(text); } catch {}

    const today = new Date().toISOString().split("T")[0];
    const targetDate = body.date || today;

    console.log(`[realtime-tracking] Buscando tarefas para ${targetDate}`);

    // GC credentials (optional — if available, we fetch OS values)
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
    const gcHeaders: Record<string, string> | null = (gcAccessToken && gcSecretToken)
      ? { "access-token": gcAccessToken, "secret-access-token": gcSecretToken, "Content-Type": "application/json" }
      : null;

    const bearerToken = await auvoLogin(auvoApiKey, auvoApiToken);

    // Fetch Auvo tasks + GC OS + GC Orçamentos in parallel
    const [tasks, gcOsMap, gcOrcMap] = await Promise.all([
      fetchAllTasks(bearerToken, targetDate, targetDate),
      gcHeaders ? fetchGcOsMap(gcHeaders) : Promise.resolve({} as Record<string, { codigo: string; valor: string }>),
      gcHeaders ? fetchGcOrcMap(gcHeaders) : Promise.resolve({} as Record<string, { codigo: string; valor: string }>),
    ]);

    console.log(`[realtime-tracking] Total: ${tasks.length} tarefas`);
    if (tasks.length > 0) {
      const s = tasks[0];
      console.log(`[realtime-tracking] Sample keys: ${Object.keys(s).join(", ")}`);
      console.log(`[realtime-tracking] Customer fields: customerDescription=${s.customerDescription}, customerName=${s.customerName}, customer=${JSON.stringify(s.customer)?.substring(0,300)}`);
    }

    // Current time for late detection (Brazil timezone UTC-3)
    const nowUTC = new Date();
    const nowBR = new Date(nowUTC.getTime() - 3 * 60 * 60 * 1000);
    const nowStr = nowBR.toISOString().split("T")[0];
    const nowTime = nowBR.toISOString().split("T")[1].substring(0, 5); // HH:MM

    // Group by technician
    const techMap: Record<string, {
      id: string;
      nome: string;
      tarefas: any[];
    }> = {};

    for (const task of tasks) {
      const techId = String(task.idUserTo || task.userToId || task.collaboratorId || "");
      const techName = String(task.userToName || task.collaboratorName || "Desconhecido").trim();
      if (!techId || techName === "Desconhecido") continue;

      if (!techMap[techId]) {
        techMap[techId] = { id: techId, nome: techName, tarefas: [] };
      }

      // Determine status label
      let statusLabel = "Agendada";
      const s = task.status;
      if (s === 3 || task.finished === true || task.finished === "true") statusLabel = "Finalizada";
      else if (s === 2 || task.checkIn === true) statusLabel = "Em andamento";
      else if (s === 4) statusLabel = "Cancelada";
      else if (s === 1) statusLabel = "Agendada";

      const taskDate = String(task.taskDate || task.date || "").split("T")[0];
      const startTime = String(task.startTime || task.startHour || "");
      const endTime = String(task.endTime || task.endHour || "");
      
      // Customer resolution
      let customerName = "";
      if (task.customerDescription) {
        customerName = String(task.customerDescription).trim();
      } else if (task.customer && typeof task.customer === "object") {
        customerName = String(task.customer.name || task.customer.description || "").trim();
      } else if (task.customerName) {
        customerName = String(task.customerName).trim();
      } else if (typeof task.customer === "string") {
        customerName = task.customer.trim();
      }
      
      const address = task.address || task.customer?.address || "";

      // Late detection: if task is "Agendada" and endTime has passed, or if no endTime and it's past 17:00
      let atrasada = false;
      if (statusLabel === "Agendada" && taskDate <= nowStr) {
        if (taskDate < nowStr) {
          // Past day = definitely late
          atrasada = true;
        } else if (endTime) {
          // Today: compare with current time
          atrasada = nowTime > endTime;
        } else if (startTime) {
          // If start time has passed by 2+ hours, consider late
          const startHour = parseInt(startTime.split(":")[0] || "0");
          const startMin = parseInt(startTime.split(":")[1] || "0");
          const nowHour = parseInt(nowTime.split(":")[0] || "0");
          const nowMin = parseInt(nowTime.split(":")[1] || "0");
          const diffMin = (nowHour * 60 + nowMin) - (startHour * 60 + startMin);
          atrasada = diffMin > 120;
        } else {
          // No time info: if past 17:00 and still "Agendada", it's late
          atrasada = nowTime > "17:00";
        }
      }

      const auvoTaskId = String(task.taskID || task.id || "");
      const gcOs = gcOsMap[auvoTaskId] || null;

      techMap[techId].tarefas.push({
        taskId: auvoTaskId,
        cliente: customerName,
        endereco: typeof address === "object" ? "" : String(address).substring(0, 100),
        status: statusLabel,
        atrasada,
        horaInicio: startTime,
        horaFim: endTime,
        data: taskDate,
        checkIn: !!task.checkIn,
        checkOut: !!task.checkOut,
        pendencia: String(task.pendency ?? task.pendencia ?? "").trim(),
        descricao: String(task.description || task.orientation || "").substring(0, 150),
        duration: String(task.duration || ""),
        gcOsCodigo: gcOs?.codigo || "",
        gcOsValor: gcOs?.valor || "",
      });
    }

    // Sort tasks by start time within each technician
    const tecnicos = Object.values(techMap).map((tech) => {
      tech.tarefas.sort((a, b) => (a.horaInicio || "").localeCompare(b.horaInicio || ""));
      const finalizadas = tech.tarefas.filter(t => t.status === "Finalizada").length;
      const emAndamento = tech.tarefas.filter(t => t.status === "Em andamento").length;
      const agendadas = tech.tarefas.filter(t => t.status === "Agendada").length;
      const atrasadas = tech.tarefas.filter(t => t.atrasada).length;
      return {
        ...tech,
        resumo: {
          total: tech.tarefas.length,
          finalizadas,
          emAndamento,
          agendadas,
          atrasadas,
        }
      };
    }).sort((a, b) => {
      if (a.resumo.emAndamento > 0 && b.resumo.emAndamento === 0) return -1;
      if (b.resumo.emAndamento > 0 && a.resumo.emAndamento === 0) return 1;
      return b.resumo.total - a.resumo.total;
    });

    // Save late/non-executed tasks to DB immediately for commission tracking
    // Persist any task detected as "atrasada" right away (even during the day)
    // Also persist all non-executed at end of day (past 18:00) or for past dates
    const shouldPersistAll = targetDate < nowStr || (targetDate === nowStr && nowTime >= "18:00");
    const hasLateTasks = tecnicos.some(t => t.tarefas.some(task => task.atrasada));

    if (shouldPersistAll || hasLateTasks) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        const naoExecutadas: any[] = [];
        for (const tech of tecnicos) {
          for (const task of tech.tarefas) {
            // Persist if: task is late OR (end of day and still scheduled/not finished)
            const isLateNow = task.atrasada;
            const isEndOfDayPending = shouldPersistAll && (task.status === "Agendada" || (task.status !== "Finalizada" && task.status !== "Em andamento"));
            if (isLateNow || isEndOfDayPending) {
              naoExecutadas.push({
                auvo_task_id: task.taskId,
                tecnico_id: tech.id,
                tecnico_nome: tech.nome,
                cliente: task.cliente || null,
                descricao: task.descricao || null,
                data_planejada: targetDate,
                status_original: isLateNow ? "Atrasada" : task.status,
              });
            }
          }
        }

        if (naoExecutadas.length > 0) {
          const { error: upsertErr } = await supabase
            .from("atividades_nao_executadas")
            .upsert(naoExecutadas, { onConflict: "auvo_task_id,data_planejada" });
          if (upsertErr) console.error("[realtime-tracking] Erro ao salvar não executadas:", upsertErr);
          else console.log(`[realtime-tracking] ${naoExecutadas.length} atividades não executadas/atrasadas salvas para ${targetDate}`);
        }
      } catch (err) {
        console.warn("[realtime-tracking] Erro ao persistir não executadas:", err);
      }
    }

    // Count total late
    const totalAtrasadas = tecnicos.reduce((s, t) => s + t.resumo.atrasadas, 0);

    return new Response(JSON.stringify({
      data: targetDate,
      total_tarefas: tasks.length,
      total_tecnicos: tecnicos.length,
      total_atrasadas: totalAtrasadas,
      tecnicos,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[realtime-tracking] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
