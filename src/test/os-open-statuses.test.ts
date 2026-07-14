import { describe, expect, it } from "vitest";
import {
  OPEN_OS_SITUATIONS,
  RECONCILIATION_OS_SITUATIONS,
  isOpenOsSituation,
} from "@/lib/osOpenStatuses";

describe("regras de OS em aberto", () => {
  it("reconhece todas as situações abertas pelo ID", () => {
    for (const situation of OPEN_OS_SITUATIONS) {
      expect(isOpenOsSituation({ gc_os_situacao_id: situation.id })).toBe(true);
    }
  });

  it("não considera FECHADO CHAMADO como OS aberta", () => {
    expect(isOpenOsSituation({ gc_os_situacao_id: "8889036", gc_os_situacao: "FECHADO CHAMADO" })).toBe(false);
  });

  it("mantém FECHADO CHAMADO somente como destino de conciliação", () => {
    expect(OPEN_OS_SITUATIONS.some((s) => (s.id as string) === "8889036")).toBe(false);
    expect(RECONCILIATION_OS_SITUATIONS.some((s) => (s.id as string) === "8889036")).toBe(true);
  });

  it("usa o nome como fallback apenas quando o ID não existe", () => {
    expect(isOpenOsSituation({ gc_os_situacao: "Executado - Aguardando Negociação Financeira" })).toBe(true);
    expect(isOpenOsSituation({ gc_os_situacao: "Cancelada" })).toBe(false);
    expect(isOpenOsSituation({})).toBe(false);
  });
});
