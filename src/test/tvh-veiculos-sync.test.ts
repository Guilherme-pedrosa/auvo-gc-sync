import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../supabase/functions/tvh-veiculos-sync/index.ts"),
  "utf8",
);

describe("sincronização de veículos do Technician & Vehicle Hub", () => {
  it("filtra apenas os valores válidos do enum ticket_status", () => {
    expect(source).toContain('const OPEN_STATUSES = ["aberto", "em_andamento", "aguardando_peca"]');
    expect(source).toContain('const CLOSED_STATUSES = ["concluido"]');
    expect(source).not.toContain('"cancelado", "resolvido"');
  });
});
