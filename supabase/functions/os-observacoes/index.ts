import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GC_BASE_URL = "https://api.gestaoclick.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function gcHeaders() {
  return {
    "access-token": Deno.env.get("GC_ACCESS_TOKEN") ?? "",
    "secret-access-token": Deno.env.get("GC_SECRET_TOKEN") ?? "",
    "Content-Type": "application/json",
  };
}

function stamp(autor: string, texto: string) {
  const data = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return `[WAI] ${data} — ${autor || "Sistema"}: ${texto}`;
}

/** GET completo → merge apenas de observacoes_interna → PUT (padrão não destrutivo do GC) */
async function enviarObsParaGc(gcOsId: string, linha: string): Promise<{ ok: boolean; erro?: string }> {
  const headers = gcHeaders();
  if (!headers["access-token"] || !headers["secret-access-token"]) {
    return { ok: false, erro: "credenciais_gc_ausentes" };
  }

  const url = `${GC_BASE_URL}/api/ordens_servicos/${gcOsId}`;
  const getResp = await fetch(url, { headers });
  const getJson = await getResp.json().catch(() => ({}));
  if (!getResp.ok) return { ok: false, erro: `gc_get_${getResp.status}` };

  const os = (getJson?.data ?? getJson) as Record<string, unknown> | null;
  if (!os || typeof os !== "object") return { ok: false, erro: "gc_os_nao_encontrada" };

  const payload: Record<string, unknown> = { ...os };
  for (const campo of ["id", "nome_situacao", "cor_situacao", "hash", "cadastrado_em", "modificado_em"]) {
    delete payload[campo];
  }
  if (!payload.data && payload.data_entrada) payload.data = payload.data_entrada;
  if (!payload.tipo) {
    payload.tipo = Array.isArray(payload.servicos) && !Array.isArray(payload.produtos) ? "servico" : "produto";
  }
  if (!payload.tipo_desconto) payload.tipo_desconto = "R$";

  const atual = String((os as any).observacoes_interna || "").trim();
  payload.observacoes_interna = atual ? `${atual}\n${linha}` : linha;

  const putResp = await fetch(url, { method: "PUT", headers, body: JSON.stringify(payload) });
  const putJson = await putResp.json().catch(() => ({}));
  if (!putResp.ok) {
    const msg = String((putJson as any)?.data?.mensagem || (putJson as any)?.mensagem || `gc_put_${putResp.status}`);
    return { ok: false, erro: msg };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    let userName = "";
    if (token) {
      const { data: userData } = await admin.auth.getUser(token);
      userId = userData?.user?.id ?? null;
      if (userId) {
        const { data: profile } = await admin
          .from("profiles").select("nome, email").eq("id", userId).maybeSingle();
        userName = String(profile?.nome || profile?.email || "").trim();
      }
    }
    if (!userId) return json({ ok: false, error: "nao_autenticado" });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list");

    if (action === "list") {
      const gcOsIds: string[] = (body?.gc_os_ids || []).map((v: unknown) => String(v)).filter(Boolean);
      const clientes: string[] = (body?.clientes || []).map((v: unknown) => String(v)).filter(Boolean);

      let query = admin.from("os_observacoes").select("*").order("created_at", { ascending: false }).limit(2000);
      if (gcOsIds.length > 0 && clientes.length > 0) {
        const inOs = gcOsIds.map((v) => `"${v.replace(/"/g, "")}"`).join(",");
        const inCli = clientes.map((v) => `"${v.replace(/"/g, "")}"`).join(",");
        query = query.or(`gc_os_id.in.(${inOs}),cliente.in.(${inCli})`);
      } else if (gcOsIds.length > 0) {
        query = query.in("gc_os_id", gcOsIds);
      } else if (clientes.length > 0) {
        query = query.in("cliente", clientes);
      }

      const { data, error } = await query;
      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true, observacoes: data ?? [] });
    }

    if (action === "create") {
      const texto = String(body?.texto || "").trim();
      if (texto.length < 2) return json({ ok: false, error: "texto_obrigatorio" });

      const gcOsId = body?.gc_os_id ? String(body.gc_os_id) : null;
      const linha = stamp(userName, texto);

      let sincronizado = false;
      let erroGc: string | null = null;
      if (gcOsId) {
        const res = await enviarObsParaGc(gcOsId, linha);
        sincronizado = res.ok;
        erroGc = res.ok ? null : (res.erro ?? "erro_desconhecido");
      } else {
        erroGc = "os_sem_vinculo_gc";
      }

      const { data, error } = await admin
        .from("os_observacoes")
        .insert({
          gc_os_id: gcOsId,
          gc_os_codigo: body?.gc_os_codigo ? String(body.gc_os_codigo) : null,
          auvo_task_id: body?.auvo_task_id ? String(body.auvo_task_id) : null,
          cliente: body?.cliente ? String(body.cliente) : null,
          texto,
          autor_id: userId,
          autor_nome: userName || null,
          sincronizado_gc: sincronizado,
          erro_gc: erroGc,
        })
        .select()
        .single();

      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true, observacao: data, sincronizado_gc: sincronizado, erro_gc: erroGc });
    }

    if (action === "resync") {
      const id = String(body?.id || "");
      if (!id) return json({ ok: false, error: "id_obrigatorio" });
      const { data: obs } = await admin.from("os_observacoes").select("*").eq("id", id).maybeSingle();
      if (!obs) return json({ ok: false, error: "observacao_nao_encontrada" });
      if (!obs.gc_os_id) return json({ ok: false, error: "os_sem_vinculo_gc" });

      const res = await enviarObsParaGc(String(obs.gc_os_id), stamp(String(obs.autor_nome || ""), String(obs.texto)));
      await admin.from("os_observacoes")
        .update({ sincronizado_gc: res.ok, erro_gc: res.ok ? null : (res.erro ?? "erro_desconhecido") })
        .eq("id", id);
      return json({ ok: res.ok, erro_gc: res.ok ? null : res.erro });
    }

    return json({ ok: false, error: "acao_invalida" });
  } catch (error) {
    console.error("[os-observacoes]", error);
    return json({ ok: false, error: (error as Error).message });
  }
});
