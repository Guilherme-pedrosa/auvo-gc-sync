import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const COLUNAS =
  "auvo_task_id, cliente, tecnico, data_tarefa, status_auvo, descricao, equipamento_nome, equipamento_id_serie, gc_os_codigo, gc_os_situacao, gc_os_valor_total, gc_os_data, gc_os_link, gc_orcamento_codigo, gc_orc_situacao, gc_orc_valor_total, gc_orc_data, gc_orc_link";

export default defineTool({
  name: "buscar_ordens_servico",
  title: "Buscar ordens de serviço",
  description:
    "Consulta o Controle de OS (tarefas do Auvo cruzadas com OS e orçamentos do GestãoClick): cliente, técnico, datas, situação e valores.",
  inputSchema: {
    cliente: z.string().optional().describe("Nome ou parte do nome do cliente"),
    tecnico: z.string().optional().describe("Nome ou parte do nome do técnico"),
    numero: z.string().optional().describe("Número da OS ou do orçamento no GestãoClick"),
    situacao: z.string().optional().describe("Texto da situação da OS ou do orçamento"),
    data_de: z.string().optional().describe("Data inicial no formato YYYY-MM-DD"),
    data_ate: z.string().optional().describe("Data final no formato YYYY-MM-DD"),
    limite: z.number().optional().describe("Máximo de registros retornados (padrão 25, máximo 100)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const limite = Math.min(Math.max(Number(input.limite) || 25, 1), 100);
    let q = supabaseForUser(ctx)
      .from("tarefas_central")
      .select(COLUNAS)
      .order("data_tarefa", { ascending: false })
      .limit(limite);

    if (input.cliente) q = q.ilike("cliente", `%${input.cliente}%`);
    if (input.tecnico) q = q.ilike("tecnico", `%${input.tecnico}%`);
    if (input.numero) q = q.or(`gc_os_codigo.eq.${input.numero},gc_orcamento_codigo.eq.${input.numero}`);
    if (input.situacao) {
      q = q.or(`gc_os_situacao.ilike.%${input.situacao}%,gc_orc_situacao.ilike.%${input.situacao}%`);
    }
    if (input.data_de) q = q.gte("data_tarefa", input.data_de);
    if (input.data_ate) q = q.lte("data_tarefa", input.data_ate);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify({ total: data?.length ?? 0, registros: data ?? [] }) }],
      structuredContent: { total: data?.length ?? 0, registros: data ?? [] },
    };
  },
});
