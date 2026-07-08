import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GC_BASE_URL = "https://api.gestaoclick.com";

// Situações de OS que representam pendência financeira / aguardando negociação
// Podem ser sobrescritas via body.situacao_ids
const DEFAULT_SITUACAO_IDS = [
  "7116099", // EXECUTADO - AGUARDANDO NEGOCIAÇÃO FINANCEIRA
];

const normalize = (s: string) =>
  (s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(ltda|me|sa|s\.a\.|s\/a|eireli|epp)\s*\.?$/i, "")
    .replace(/[.\-\/]/g, "")
    .replace(/\s+/g, " ");

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchOsBySituacao(gcHeaders: Record<string, string>, situacaoId: string) {
  const records: any[] = [];
  const MAX_PAGES = 30;
  for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${pagina}&situacao_id=${situacaoId}`;
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(url, { headers: gcHeaders });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 3000 + attempt * 2000));
        continue;
      }
      break;
    }
    if (!res || !res.ok) break;
    const json = await res.json().catch(() => ({}));
    const data = Array.isArray(json?.data) ? json.data : [];
    records.push(...data);
    const totalPaginas = Number(json?.meta?.total_paginas || 1);
    if (pagina >= totalPaginas) break;
  }
  return records;
}

async function fetchRecebimentosEmAberto(gcHeaders: Record<string, string>) {
  const records: any[] = [];
  const MAX_PAGES = 40;
  // ab = em aberto ; at = em atraso — busca ambos
  for (const liquidado of ["ab", "at"]) {
    for (let pagina = 1; pagina <= MAX_PAGES; pagina++) {
      const url = `${GC_BASE_URL}/api/recebimentos?limite=100&pagina=${pagina}&liquidado=${liquidado}`;
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(url, { headers: gcHeaders });
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 3000 + attempt * 2000));
          continue;
        }
        break;
      }
      if (!res || !res.ok) break;
      const json = await res.json().catch(() => ({}));
      const data = Array.isArray(json?.data) ? json.data : [];
      for (const r of data) records.push({ ...r, _liquidado: liquidado });
      const totalPaginas = Number(json?.meta?.total_paginas || 1);
      if (pagina >= totalPaginas) break;
    }
  }
  return records;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN")!;
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return ok({ ok: false, error: "Não autorizado" }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) return ok({ ok: false, error: "Não autorizado" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile } = await admin
      .from("profiles")
      .select("id, grupo_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.grupo_id) return ok({ ok: false, error: "Usuário sem grupo configurado" });

    const { data: membros } = await admin
      .from("grupo_cliente_membros")
      .select("cliente_nome")
      .eq("grupo_id", profile.grupo_id);
    const clientesNorm = new Set((membros || []).map((m: any) => normalize(m.cliente_nome)));
    if (clientesNorm.size === 0) {
      return ok({ ok: true, os_list: [], recebimentos: [], totals: { qtd_os: 0, valor_os: 0, qtd_recebimentos: 0, valor_recebimentos: 0 } });
    }

    const body = await req.json().catch(() => ({}));
    const situacaoIds: string[] = Array.isArray(body?.situacao_ids) && body.situacao_ids.length > 0
      ? body.situacao_ids.map(String)
      : DEFAULT_SITUACAO_IDS;

    const gcHeaders = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    // 1. OS aguardando negociação
    const osRaw: any[] = [];
    for (const sit of situacaoIds) {
      const arr = await fetchOsBySituacao(gcHeaders, sit);
      osRaw.push(...arr);
    }
    const osFiltered = osRaw
      .filter((o: any) => clientesNorm.has(normalize(String(o.nome_cliente || ""))))
      .map((o: any) => ({
        gc_os_id: String(o.id),
        codigo: String(o.codigo || ""),
        cliente: String(o.nome_cliente || ""),
        situacao: String(o.nome_situacao || ""),
        situacao_id: String(o.situacao_id || ""),
        cor_situacao: String(o.cor_situacao || ""),
        data: String(o.data || ""),
        data_final: String(o.data_final || ""),
        valor_total: Number(o.valor_total || 0),
        descricao: String(o.descricao || ""),
        vendedor: String(o.nome_vendedor || ""),
        link: o.hash
          ? `https://gestaoclick.com/cobranca/${o.hash}`
          : `https://gestaoclick.com/ordens_servicos/editar/${o.id}`,
      }));

    // Fallback: buscar hash individual das OS que não vieram na listagem
    await Promise.all(
      osFiltered
        .filter((o) => !o.link.includes("/cobranca/"))
        .map(async (o) => {
          try {
            const res = await fetch(`${GC_BASE_URL}/api/ordens_servicos/${o.gc_os_id}`, {
              headers: gcHeaders,
            });
            if (!res.ok) return;
            const j = await res.json().catch(() => ({}));
            const hash = j?.data?.hash;
            if (hash) o.link = `https://gestaoclick.com/cobranca/${hash}`;
          } catch { /* ignore */ }
        }),
    );

    // 2. Recebimentos em aberto / atraso
    const recRaw = await fetchRecebimentosEmAberto(gcHeaders);
    const hoje = new Date().toISOString().slice(0, 10);
    const recebimentos = recRaw
      .filter((r: any) => clientesNorm.has(normalize(String(r.nome_cliente || r.nome || ""))))
      .map((r: any) => {
        const venc = String(r.data_vencimento || "").slice(0, 10);
        const atrasado = venc && venc < hoje;
        return {
          gc_recebimento_id: String(r.id),
          codigo: String(r.codigo || ""),
          descricao: String(r.descricao || ""),
          cliente: String(r.nome_cliente || r.nome || ""),
          valor: Number(r.valor || 0),
          valor_pago: Number(r.valor_pago || 0),
          valor_pendente: Math.max(0, Number(r.valor || 0) - Number(r.valor_pago || 0)),
          data_vencimento: venc,
          data_competencia: String(r.data_competencia || "").slice(0, 10),
          liquidado: String(r._liquidado || ""),
          atrasado,
          os_codigo: String(r.os_codigo || r.numero_os || ""),
          forma_pagamento: String(r.nome_forma_pagamento || ""),
          parcela: r.parcela ? String(r.parcela) : "",
        };
      });

    const totals = {
      qtd_os: osFiltered.length,
      valor_os: osFiltered.reduce((s, o) => s + o.valor_total, 0),
      qtd_recebimentos: recebimentos.length,
      valor_recebimentos: recebimentos.reduce((s, r) => s + r.valor_pendente, 0),
      valor_atrasado: recebimentos.filter((r) => r.atrasado).reduce((s, r) => s + r.valor_pendente, 0),
      qtd_atrasado: recebimentos.filter((r) => r.atrasado).length,
    };

    return ok({ ok: true, os_list: osFiltered, recebimentos, totals });
  } catch (err) {
    console.error("[portal-negociacao-fetch] erro:", err);
    return ok({ ok: false, error: (err as Error)?.message || "Erro interno" });
  }
});