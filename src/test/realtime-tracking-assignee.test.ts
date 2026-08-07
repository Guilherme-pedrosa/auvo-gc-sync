import { describe, expect, it } from "vitest";
import { resolveAuvoTaskAssignee } from "../../supabase/functions/_shared/auvo-task-assignee.ts";

describe("responsável da Agenda de Técnicos", () => {
  it("usa idUserTo e userToName retornados pelo Auvo", () => {
    expect(resolveAuvoTaskAssignee({
      idUserTo: 184612,
      userToName: "Fred Bessa",
      gcVendedor: "Angélica",
    })).toEqual({ id: "184612", nome: "Fred Bessa" });
  });

  it("resolve também o formato aninhado do usuário Auvo", () => {
    expect(resolveAuvoTaskAssignee({
      userTo: { userID: 192262, name: "Elton" },
      vendedor: "Maria Eduarda",
    })).toEqual({ id: "192262", nome: "Elton" });
  });

  it("não inventa um técnico usando vendedor ou dado comercial", () => {
    expect(resolveAuvoTaskAssignee({
      gcVendedor: "Angélica",
      vendedor: "Maria Eduarda",
    })).toBeNull();
  });
});
