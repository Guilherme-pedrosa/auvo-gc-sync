import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../supabase/functions/tvh-veiculos-sync/index.ts"),
  "utf8",
);

describe("sincronizacao de veiculos do Technician & Vehicle Hub", () => {
  it("nao envia valores de ticket_status para o enum remoto", () => {
    expect(source).toContain('const OPEN_STATUSES = ["aberto", "em_andamento", "aguardando_peca"]');
    expect(source).toContain('const CLOSED_STATUSES = ["concluido"]');
    expect(source).not.toContain("&status=in.");
  });

  it("nao bloqueia os veiculos quando os alertas falham", () => {
    expect(source).toContain("let maintenanceWarning: string | null = null");
    expect(source).toContain("Veículos importados sem alertas de manutenção");
    expect(source).toContain("maintenance_warning: maintenanceWarning");
  });
});
