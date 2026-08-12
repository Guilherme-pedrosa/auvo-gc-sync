import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAuvoTaskDate,
  extractAuvoError,
  normalizeChoice,
  positiveInteger,
  resolveTaskLocation,
} from "../../supabase/functions/_shared/auvo-task-create";

const root = resolve(__dirname, "../..");

describe("payload de criação de tarefa Auvo", () => {
  it("usa endereço do Auvo e só envia coordenadas reais", () => {
    expect(resolveTaskLocation({
      address: "Av. Principal, 10",
      latitude: -16.33,
      longitude: -48.95,
    })).toEqual({
      address: "Av. Principal, 10",
      source: "auvo",
      latitude: -16.33,
      longitude: -48.95,
    });

    expect(resolveTaskLocation({ address: "Av. Principal, 10", latitude: 0, longitude: 0 }))
      .toEqual({ address: "Av. Principal, 10", source: "auvo" });
    expect(resolveTaskLocation({ address: "Av. Principal, 10", latitude: null, longitude: -48.95 }))
      .toEqual({ address: "Av. Principal, 10", source: "auvo" });
  });

  it("recupera o endereço do cadastro central RH quando o espelho Auvo está vazio", () => {
    expect(resolveTaskLocation(
      { address: "", latitude: 0, longitude: 0 },
      { endereco: "Rodovia BR-470, KM 230", cidade: "Carlos Barbosa", uf: "RS", cep: "95185-000" },
    )).toEqual({
      address: "Rodovia BR-470, KM 230, Carlos Barbosa/RS, 95185-000",
      source: "rh_clientes",
    });
  });

  it("não fabrica endereço nem coordenadas quando ambos estão ausentes", () => {
    expect(resolveTaskLocation({}, null)).toBeNull();
  });

  it("valida IDs, opções e data civil antes do POST", () => {
    expect(positiveInteger("220038")).toBe(220038);
    expect(positiveInteger("abc")).toBeNull();
    expect(normalizeChoice("2", [1, 2, 3])).toBe(2);
    expect(normalizeChoice("8", [1, 2, 3])).toBeNull();
    expect(buildAuvoTaskDate("2026-08-26", "17:00")).toBe("2026-08-26T17:00:00");
    expect(buildAuvoTaskDate("2026-02-30", "17:00")).toBeNull();
    expect(buildAuvoTaskDate("2026-08-26", "25:00")).toBeNull();
  });

  it("preserva a mensagem real devolvida pela Auvo", () => {
    expect(extractAuvoError({ Message: "Customer address is invalid" }, 400))
      .toBe("Customer address is invalid");
    expect(extractAuvoError({ errors: { equipmentsId: ["Equipment does not belong to customer"] } }, 400))
      .toBe("Equipment does not belong to customer");
  });

  it("usa o operador logado e não cria tarefa sem os vínculos escolhidos", () => {
    const dialog = readFileSync(
      resolve(root, "src/components/operacional/CriarTarefaGeralDialog.tsx"),
      "utf8",
    );
    const edge = readFileSync(
      resolve(root, "supabase/functions/auvo-task-update/index.ts"),
      "utf8",
    );

    expect(dialog).toContain("idUserFrom: openerAuvoId");
    expect(edge).not.toContain('address: cust?.address || "Endereço não informado"');
    expect(edge).not.toContain("__retriedWithoutOptionalFields");
    expect(edge).toContain("resolveTaskLocation(cust, rhCustomer)");
    expect(edge).toContain("POST de criação não é idempotente");
  });
});
