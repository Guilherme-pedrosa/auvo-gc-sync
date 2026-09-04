import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "consultar_agenda",
  title: "Consultar agenda da equipe",
  description:
    "Consulta os agendamentos da equipe por período, técnico ou cliente, com duração planejada, origem (Auvo, contrato ou manual) e status.",
  inputSchema: {
    data_de: z.string().optional().describe("Data inicial no formato YYYY-MM-DD"),
    data_ate: z.string().optional().describe("Data final no formato YYYY-MM-DD"),
    colaborador: z.string().optional().describe("Nome ou parte do nome do técnico"),
    cliente: z.string().optional().describe("Nome ou parte do nome do cliente"),
    limite: z.number().optional().describe("Máximo de registros (padrão 50, máximo 200)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const limite = Math.min(Math.max(Number(input.limite) || 50, 1), 200);
    let q = supabaseForUser(ctx)
      .from("agenda_agendamentos")
      .select(
        "data, hora_inicio, hora_fim, colaborador_nome, cliente, descricao, duracao_planejada_minutos, origem, status, gc_os_codigo, gc_orcamento_codigo, auvo_task_id",
      )
      .order("data", { ascending: true })
      .limit(limite);

    if (input.data_de) q = q.gte("data", input.data_de);
    if (input.data_ate) q = q.lte("data", input.data_ate);
    if (input.colaborador) q = q.ilike("colaborador_nome", `%${input.colaborador}%`);
    if (input.cliente) q = q.ilike("cliente", `%${input.cliente}%`);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const minutos = (data ?? []).reduce((acc, r) => acc + (Number(r.duracao_planejada_minutos) || 0), 0);
    const payload = { total: data?.length ?? 0, horas_planejadas: Number((minutos / 60).toFixed(2)), agendamentos: data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
