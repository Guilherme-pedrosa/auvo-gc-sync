import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "observacoes_os",
  title: "Ler observações de OS",
  description: "Lê as observações internas registradas no Controle de OS para uma ordem de serviço, tarefa ou cliente.",
  inputSchema: {
    gc_os_codigo: z.string().optional().describe("Código da OS no GestãoClick"),
    auvo_task_id: z.string().optional().describe("ID da tarefa no Auvo"),
    cliente: z.string().optional().describe("Nome ou parte do nome do cliente"),
    limite: z.number().optional().describe("Máximo de registros (padrão 20, máximo 50)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const limite = Math.min(Math.max(Number(input.limite) || 20, 1), 50);
    let q = supabaseForUser(ctx)
      .from("os_observacoes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limite);

    if (input.gc_os_codigo) q = q.eq("gc_os_codigo", input.gc_os_codigo);
    if (input.auvo_task_id) q = q.eq("auvo_task_id", input.auvo_task_id);
    if (input.cliente) q = q.ilike("cliente", `%${input.cliente}%`);

    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify({ total: data?.length ?? 0, observacoes: data ?? [] }) }],
      structuredContent: { total: data?.length ?? 0, observacoes: data ?? [] },
    };
  },
});
