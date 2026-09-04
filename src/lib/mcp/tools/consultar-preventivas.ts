import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "consultar_preventivas",
  title: "Consultar preventivas de equipamentos",
  description:
    "Consulta a preventiva dos equipamentos: última preventiva, próxima prevista, periodicidade, criticidade e status (Em dia, Atrasada, Sem registro).",
  inputSchema: {
    cliente: z.string().optional().describe("Nome ou parte do nome do cliente"),
    equipamento: z.string().optional().describe("Nome do equipamento"),
    identificador: z.string().optional().describe("Série ou patrimônio do equipamento"),
    status: z.string().optional().describe("Filtro pelo status da preventiva"),
    limite: z.number().optional().describe("Máximo de registros (padrão 25, máximo 100)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const limite = Math.min(Math.max(Number(input.limite) || 25, 1), 100);
    let q = supabaseForUser(ctx)
      .from("equipamento_preventiva_consolidado")
      .select(
        "nome, identificador, cliente, categoria, marca, tipo_nome, criticidade, periodicidade, periodicidade_meses, ultima_preventiva, ultima_preventiva_tecnico, proxima_preventiva, status_preventiva, total_tarefas, equip_status",
      )
      .limit(limite);

    if (input.cliente) q = q.ilike("cliente", `%${input.cliente}%`);
    if (input.equipamento) q = q.ilike("nome", `%${input.equipamento}%`);
    if (input.identificador) q = q.ilike("identificador", `%${input.identificador}%`);
    if (input.status) q = q.ilike("status_preventiva", `%${input.status}%`);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify({ total: data?.length ?? 0, equipamentos: data ?? [] }) }],
      structuredContent: { total: data?.length ?? 0, equipamentos: data ?? [] },
    };
  },
});
