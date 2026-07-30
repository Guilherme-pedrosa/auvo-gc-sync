// ═══════════════════════════════════════════════════════════════════
// analises-operacionais
// Gera análises gerenciais (IA) a partir das preventivas realizadas.
// Fonte: equipamento_preventiva_consolidado + tarefas_central (Auvo/GC já sincronizados).
// Uma análise por preventiva (chave: auvo_task_id).
// ═══════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.6-flash";

type Ctx = Record<string, unknown>;

function truncate(v: unknown, max = 1500): string {
  const s = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

async function analisar(apiKey: string, ctx: Ctx) {
  const prompt = `Você é um ANALISTA OPERACIONAL de manutenção. Analise a preventiva abaixo e produza uma avaliação gerencial.
Não crie ordens de serviço, compras ou orçamentos: apenas sintetize fatos, classifique criticidade e sugira ação.
Leia com atenção o relato do técnico E TODAS as respostas do questionário (campos como SERVIÇOS NECESSÁRIOS, PEÇAS NECESSÁRIAS, OBSERVAÇÕES, HORAS PARA EXECUÇÃO). Qualquer serviço necessário, peça necessária, higienização pendente, risco de segurança, retorno ou alinhamento com cliente é PENDÊNCIA — nesse caso satisfacao NUNCA pode ser 100 e a prioridade deve refletir o risco (risco de incêndio/segurança = alta ou critica).
Só use "Preventiva concluída integralmente sem observações relevantes.", pendência "Sem pendências", ação "Nenhuma ação necessária." e prioridade "baixa" quando o questionário e o relato estiverem realmente vazios de qualquer necessidade.
Se o contexto vier vazio (sem relato e sem questionário), responda diagnóstico "Sem dados de execução sincronizados para avaliação.", pendência "Dados ausentes", ação "Revisar sincronização da tarefa.", prioridade "media" e satisfacao null.

DADOS DA PREVENTIVA (JSON):
${JSON.stringify(ctx)}

Responda SOMENTE com JSON válido no formato:
{"diagnostico":"síntese objetiva do atendimento, no máximo 240 caracteres","pendencia":"principal pendência resumida em até 40 caracteres","acao_sugerida":"recomendação curta em até 60 caracteres","prioridade":"baixa|media|alta|critica","satisfacao":0}
satisfacao = percentual inteiro de 0 a 100 representando o quão completa/satisfatória foi a preventiva.`;

  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("SEM_CREDITOS");
  if (!res.ok) throw new Error(`AI_${res.status}: ${truncate(await res.text(), 300)}`);

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = String(raw).match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }

  const prio = String(parsed.prioridade || "baixa").toLowerCase();
  const sat = Number(parsed.satisfacao);
  return {
    diagnostico: String(parsed.diagnostico || "Análise indisponível.").slice(0, 400),
    pendencia: String(parsed.pendencia || "Sem pendências").slice(0, 60),
    acao_sugerida: String(parsed.acao_sugerida || "Nenhuma ação necessária.").slice(0, 120),
    prioridade: ["baixa", "media", "alta", "critica"].includes(prio) ? prio : "baixa",
    satisfacao: Number.isFinite(sat) ? Math.max(0, Math.min(100, Math.round(sat))) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ ok: false, error: "LOVABLE_API_KEY ausente" });

    const body = await req.json().catch(() => ({}));
    const inicio: string = body.inicio;
    const fim: string = body.fim;
    const force: boolean = !!body.force;
    const limit: number = Math.min(Number(body.limit) || 40, 60);
    if (!inicio || !fim) return json({ ok: false, error: "informe inicio e fim" });

    // 1) Preventivas do período
    const { data: consolidado, error: e1 } = await supabase
      .from("equipamento_preventiva_consolidado")
      .select(
        "auvo_equipment_id, identificador, nome, cliente, categoria, marca, criticidade, periodicidade, ultima_preventiva, ultima_preventiva_task_id, ultima_preventiva_tecnico, ultima_preventiva_link",
      )
      .gte("ultima_preventiva", inicio)
      .lte("ultima_preventiva", fim)
      .not("ultima_preventiva_task_id", "is", null);
    if (e1) throw e1;

    const preventivas = (consolidado || []).filter((p: any) => p.ultima_preventiva_task_id);
    const taskIds = [...new Set(preventivas.map((p: any) => String(p.ultima_preventiva_task_id)))];

    // 2) Análises já existentes (evita duplicidade)
    const existentes = new Set<string>();
    for (let i = 0; i < taskIds.length; i += 500) {
      const { data } = await supabase
        .from("analises_operacionais")
        .select("auvo_task_id")
        .in("auvo_task_id", taskIds.slice(i, i + 500));
      (data || []).forEach((r: any) => existentes.add(String(r.auvo_task_id)));
    }

    const pendentes = preventivas.filter(
      (p: any) => force || !existentes.has(String(p.ultima_preventiva_task_id)),
    );
    const lote = pendentes.slice(0, limit);

    if (!lote.length) {
      return json({ ok: true, total: preventivas.length, restantes: 0, processadas: 0, erros: 0 });
    }

    // 3) Detalhes das tarefas
    const loteIds = lote.map((p: any) => String(p.ultima_preventiva_task_id));
    const tarefas = new Map<string, any>();
    for (let i = 0; i < loteIds.length; i += 200) {
      const { data, error: eT } = await supabase
        .from("tarefas_central")
        .select(
          "auvo_task_id, cliente, tecnico, status_auvo, orientacao, descricao, pendencia, questionario_respostas, data_tarefa, data_conclusao, auvo_task_url, auvo_link, equipamento_nome, gc_os_codigo, gc_orcamento_codigo",
        )
        .in("auvo_task_id", loteIds.slice(i, i + 200));
      if (eT) throw eT;
      // Pode existir mais de uma linha por auvo_task_id (shells "Pendente vínculo Auvo",
      // OS distintas compartilhando a mesma tarefa). Escolhe sempre a mais rica.
      const score = (t: any) =>
        (String(t.questionario_respostas ?? "").length > 5 ? 1000 : 0) +
        String(t.descricao ?? "").length +
        String(t.orientacao ?? "").length +
        String(t.pendencia ?? "").length +
        (t.status_auvo && !String(t.status_auvo).toLowerCase().includes("pendente vínculo") ? 500 : 0);
      (data || []).forEach((t: any) => {
        const key = String(t.auvo_task_id);
        const atual = tarefas.get(key);
        if (!atual || score(t) > score(atual)) tarefas.set(key, t);
      });
    }

    // 4) Grupos por cliente
    const { data: membros } = await supabase.from("grupo_cliente_membros").select("cliente_nome, grupo_id");
    const { data: grupos } = await supabase.from("grupos_clientes").select("id, nome");
    const nomeGrupo = new Map((grupos || []).map((g: any) => [g.id, g.nome]));
    const grupoPorCliente = new Map(
      (membros || []).map((m: any) => [String(m.cliente_nome || "").trim().toUpperCase(), nomeGrupo.get(m.grupo_id)]),
    );

    let processadas = 0;
    let erros = 0;
    const falhas: string[] = [];

    for (const p of lote) {
      const taskId = String(p.ultima_preventiva_task_id);
      const t = tarefas.get(taskId) || {};
      const cliente = p.cliente || t.cliente || null;

      const ctx: Ctx = {
        cliente,
        equipamento: p.nome || t.equipamento_nome,
        identificador: p.identificador,
        marca: p.marca,
        categoria: p.categoria,
        criticidade: p.criticidade,
        data_preventiva: p.ultima_preventiva,
        status_tarefa: t.status_auvo || null,
        tecnico: p.ultima_preventiva_tecnico || t.tecnico || null,
        relato_cliente: truncate(t.orientacao),
        relato_tecnico: truncate(t.descricao),
        pendencia_registrada: truncate(t.pendencia, 800),
        os_simplificada: truncate(t.questionario_respostas, 6000),
        gc_os: t.gc_os_codigo || null,
        gc_orcamento: t.gc_orcamento_codigo || null,
      };

      try {
        const ia = await analisar(apiKey, ctx);
        const { error } = await supabase.from("analises_operacionais").upsert(
          {
            auvo_task_id: taskId,
            auvo_equipment_id: p.auvo_equipment_id,
            equipamento_nome: p.nome || t.equipamento_nome || null,
            identificador: p.identificador,
            cliente,
            grupo_nome: grupoPorCliente.get(String(cliente || "").trim().toUpperCase()) || null,
            marca: p.marca,
            categoria: p.categoria,
            tecnico: ctx.tecnico as string | null,
            data_preventiva: p.ultima_preventiva,
            status_tarefa: t.status_auvo || null,
            diagnostico_ia: ia.diagnostico,
            pendencia: ia.pendencia,
            acao_sugerida: ia.acao_sugerida,
            prioridade: ia.prioridade,
            satisfacao: ia.satisfacao,
            auvo_link:
              t.auvo_task_url ||
              p.ultima_preventiva_link ||
              t.auvo_link ||
              `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${taskId}`,
            contexto: ctx,
            data_analise: new Date().toISOString(),
          },
          { onConflict: "auvo_task_id" },
        );
        if (error) throw error;
        processadas++;
      } catch (err) {
        erros++;
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err
              ? JSON.stringify(err)
              : String(err);
        console.error("falha", taskId, msg);
        falhas.push(`${taskId}: ${msg}`);
        if (msg === "RATE_LIMIT" || msg === "SEM_CREDITOS") break;
      }
    }

    return json({
      ok: true,
      total: preventivas.length,
      processadas,
      erros,
      restantes: Math.max(pendentes.length - lote.length, 0),
      falhas: falhas.slice(0, 5),
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
