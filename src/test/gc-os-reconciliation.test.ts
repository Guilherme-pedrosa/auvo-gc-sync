import { describe, expect, it, vi } from "vitest";
import { readGcOsForReconciliation } from "../../supabase/functions/central-sync/gc-os-reconciliation";

describe("consulta segura de situação no GC, compartilhada por relatório e sincronização automática", () => {
  it.each([400, 401, 403, 429, 500])("HTTP %i não confirma exclusão", async status => {
    const read = vi.fn(async () => Response.json({ code: status, status: "error",
      data: { mensagem: "Você não possui permissão para acessar este pedido!" } }, { status }));
    const result = await readGcOsForReconciliation("389831437", read);
    expect(result).toEqual({ kind: "unavailable", warning: { os_id: "389831437", status,
      message: `OS 389831437: HTTP ${status} — Você não possui permissão para acessar este pedido!. Registro preservado.` } });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([404, 410])("HTTP %i confirma documento ausente", async status => {
    expect(await readGcOsForReconciliation("77", async () => new Response(null, { status }))).toEqual({ kind: "missing" });
  });

  it.each([{}, { data: {} }, { data: { id: "78" } }])("preserva a OS com resposta 200 não confirmada: %j", async payload => {
    expect(await readGcOsForReconciliation("77", async () => Response.json(payload))).toMatchObject({ kind: "unavailable",
      warning: { os_id: "77", status: 200, message: expect.stringContaining("identidade") } });
  });

  it("preserva diante de JSON inválido e timeout de transporte", async () => {
    expect(await readGcOsForReconciliation("77", async () => new Response("{incompleto"))).toMatchObject({ kind: "unavailable" });
    expect(await readGcOsForReconciliation("77", async () => { throw new DOMException("Timeout", "TimeoutError"); }))
      .toMatchObject({ kind: "unavailable", warning: { os_id: "77", status: null } });
  });

  it("aceita apenas o documento da identidade consultada e conserva seu conteúdo", async () => {
    const os = { id: "77", nome_situacao: "EXECUTADO", situacao_id: "7116099" };
    expect(await readGcOsForReconciliation("77", async () => Response.json({ data: os }))).toEqual({ kind: "confirmed", os });
  });
});
