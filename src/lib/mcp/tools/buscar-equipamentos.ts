import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "buscar_equipamentos",
  title: "Buscar equipamentos",
  description: "Lista equipamentos cadastrados (Auvo) por cliente, nome ou série, com marca, categoria e status.",
  inputSchema: {
    cliente: z.string().optional().describe("Nome ou parte do nome do cliente"),
    nome: z.string().optional().describe("Nome do equipamento"),
    identificador: z.string().optional().describe("Série ou patrimônio"),
    limite: z.number().optional().describe("Máximo de registros (padrão 25, máximo 100)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const limite = Math.min(Math.max(Number(input.limite) || 25, 1), 100);
    let q = supabaseForUser(ctx)
      .from("equipamentos_auvo")
      .select("nome, descricao, identificador, cliente, categoria, marca, status, auvo_equipment_id")
      .limit(limite);

    if (input.cliente) q = q.ilike("cliente", `%${input.cliente}%`);
    if (input.nome) q = q.ilike("nome", `%${input.nome}%`);
    if (input.identificador) q = q.ilike("identificador", `%${input.identificador}%`);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify({ total: data?.length ?? 0, equipamentos: data ?? [] }) }],
      structuredContent: { total: data?.length ?? 0, equipamentos: data ?? [] },
    };
  },
});
