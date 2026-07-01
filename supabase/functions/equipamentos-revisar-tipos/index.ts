import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Sugestao = {
  equip_id: string;
  identificador: string;
  nome: string;
  cliente: string;
  tipo_atual_id: string | null;
  tipo_atual_nome: string | null;
  tipo_sugerido_id: string | null;
  tipo_sugerido_nome: string | null;
  confianca: number;
  motivo: string;
  mudou: boolean;
};

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json();
    const mode = body.mode as "analyze" | "apply";

    // Carrega tipos
    const { data: tipos } = await sb
      .from("tipos_equipamento")
      .select("id, nome, categoria, palavras_chave")
      .eq("ativo", true)
      .order("nome");
    const tiposList = tipos ?? [];

    if (mode === "analyze") {
      const grupoId: string | null = body.grupo_id ?? null;
      const cliente: string | null = body.cliente ?? null;
      const apenasSemTipo: boolean = !!body.apenas_sem_tipo;
      const equipIds: string[] | null = Array.isArray(body.equip_ids) && body.equip_ids.length
        ? body.equip_ids.map((x: any) => String(x))
        : null;
      const todos: boolean = !!body.todos;

      // Resolve escopo de clientes (ignorado se equip_ids for informado)
      let clientes: string[] | null = null;
      if (equipIds) {
        // escopo direto por IDs
      } else if (todos) {
        // escopo global — nenhum filtro de cliente
      } else if (grupoId) {
        const { data: m } = await sb
          .from("grupo_cliente_membros")
          .select("cliente_nome")
          .eq("grupo_id", grupoId);
        clientes = (m ?? []).map((r: any) => r.cliente_nome);
        if (!clientes.length) return ok({ ok: true, sugestoes: [] });
      } else if (cliente) {
        clientes = [cliente];
      } else {
        return ok({ ok: false, error: "Informe grupo_id, cliente, equip_ids ou todos" }, 400);
      }

      let q = sb
        .from("equipamentos_auvo")
        .select("id, identificador, nome, cliente, tipo_id, status")
        .eq("status", "Ativo");
      if (equipIds) q = q.in("id", equipIds);
      else if (clientes && clientes.length) q = q.in("cliente", clientes);
      const { data: equips, error } = await q.limit(5000);
      if (error) return ok({ ok: false, error: error.message }, 500);

      const filtered = (equips ?? []).filter((e: any) => !apenasSemTipo || !e.tipo_id);
      if (!filtered.length) return ok({ ok: true, sugestoes: [] });

      // Prompt para IA
      const tipoMap = new Map(tiposList.map((t: any) => [t.id, t]));
      const tiposPrompt = tiposList.map((t: any, i: number) =>
        `${i + 1}. id=${t.id} | "${t.nome}" (categoria: ${t.categoria || "-"})${t.palavras_chave ? ` | palavras-chave: ${t.palavras_chave}` : ""}`
      ).join("\n");

      const equipsPrompt = filtered.map((e: any) => ({
        equip_id: e.id,
        nome: e.nome,
        tipo_atual_id: e.tipo_id,
      }));

      const system = `Você é um técnico especialista em equipamentos de cozinhas profissionais (food service). Sua tarefa é classificar cada equipamento na CATEGORIA correta dentre a lista fornecida, baseado SOMENTE no nome do equipamento. Se nenhuma categoria for adequada, retorne tipo_sugerido_id=null. Seja conservador: se já está correto, repita o tipo atual.`;

      const user = `LISTA DE TIPOS DISPONÍVEIS:\n${tiposPrompt}\n\nEQUIPAMENTOS A CLASSIFICAR (JSON):\n${JSON.stringify(equipsPrompt)}\n\nResponda APENAS com JSON no formato:\n{"resultados":[{"equip_id":"...","tipo_sugerido_id":"... ou null","confianca":0-100,"motivo":"breve justificativa"}]}`;

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!aiRes.ok) {
        const t = await aiRes.text();
        return ok({ ok: false, error: `IA falhou (${aiRes.status}): ${t.slice(0, 300)}` }, 200);
      }
      const aiJson = await aiRes.json();
      const content = aiJson?.choices?.[0]?.message?.content ?? "{}";
      let parsed: any = {};
      try { parsed = JSON.parse(content); } catch { parsed = {}; }
      const resultados: any[] = parsed.resultados ?? [];

      const sugestoes: Sugestao[] = filtered.map((e: any) => {
        const r = resultados.find((x) => x.equip_id === e.id);
        const tipoAtual = e.tipo_id ? tipoMap.get(e.tipo_id) as any : null;
        const sugId = r?.tipo_sugerido_id || null;
        const sugTipo = sugId ? (tipoMap.get(sugId) as any) : null;
        return {
          equip_id: e.id,
          identificador: e.identificador,
          nome: e.nome,
          cliente: e.cliente,
          tipo_atual_id: e.tipo_id,
          tipo_atual_nome: tipoAtual?.nome ?? null,
          tipo_sugerido_id: sugId,
          tipo_sugerido_nome: sugTipo?.nome ?? null,
          confianca: Math.max(0, Math.min(100, Number(r?.confianca ?? 0))),
          motivo: String(r?.motivo ?? ""),
          mudou: (e.tipo_id || null) !== (sugId || null),
        };
      });

      return ok({ ok: true, total: sugestoes.length, sugestoes });
    }

    if (mode === "apply") {
      const updates = (body.updates ?? []) as Array<{ equip_id: string; tipo_id: string | null }>;
      let ok_count = 0, fail = 0;
      for (const u of updates) {
        const { error } = await sb
          .from("equipamentos_auvo")
          .update({ tipo_id: u.tipo_id })
          .eq("id", u.equip_id);
        if (error) fail++; else ok_count++;
      }
      return ok({ ok: true, aplicados: ok_count, falhas: fail });
    }

    return ok({ ok: false, error: "mode inválido" }, 400);
  } catch (e) {
    return ok({ ok: false, error: (e as Error).message }, 200);
  }
});