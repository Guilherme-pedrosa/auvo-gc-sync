import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PREVENTIVA_TASK_TYPE_IDS,
  isPlannedNextDateOutdated,
  isPreventivaTaskType,
  shouldUsePlannedLastExecution,
} from "@/lib/preventivaPolicy";
import { buildPreventivePlanPatch } from "../../supabase/functions/preventiva-consolidar/plan-reconciliation";

const root = resolve(__dirname, "../..");
const page = readFileSync(resolve(root, "src/pages/financeiro/EquipamentosPreventivosPage.tsx"), "utf8");
const consolidator = readFileSync(resolve(root, "supabase/functions/preventiva-consolidar/index.ts"), "utf8");
const equipmentSync = readFileSync(resolve(root, "supabase/functions/equipment-sync/index.ts"), "utf8");

describe("fonte de verdade das preventivas de equipamentos", () => {
  it("aceita somente Preventiva + OS e Preventiva Contrato", () => {
    expect(PREVENTIVA_TASK_TYPE_IDS).toEqual(["180175", "180176"]);
    expect(isPreventivaTaskType("180175")).toBe(true);
    expect(isPreventivaTaskType("180176")).toBe(true);
    expect(isPreventivaTaskType("180177")).toBe(false);
    expect(isPreventivaTaskType("202616")).toBe(false);
    expect(isPreventivaTaskType("235724")).toBe(false);
  });

  it("não deixa o plano antigo da Everest/NIP substituir a preventiva real", () => {
    expect(shouldUsePlannedLastExecution("2026-02-06", "2026-07-07", "180176")).toBe(false);
    expect(isPlannedNextDateOutdated("2026-07-01", "2026-07-07")).toBe(true);
  });

  it("mantém o plano como fallback quando ele contém uma preventiva válida mais nova", () => {
    expect(shouldUsePlannedLastExecution("2026-08-10", "2026-07-07", "180175")).toBe(true);
    expect(shouldUsePlannedLastExecution("2026-08-10", "2026-07-07", "180177")).toBe(false);
  });

  it("reconcilia o cache do plano sem apagar uma próxima data futura válida", () => {
    expect(buildPreventivePlanPatch(
      {
        ultima_execucao_data: "2026-02-06",
        ultima_execucao_task_id: "69482546",
        proxima_data: "2026-07-01",
      },
      {
        ultima_preventiva: "2026-07-07",
        ultima_preventiva_task_id: "76542478",
        proxima_preventiva: "2026-08-07",
      },
    )).toEqual({
      ultima_execucao_data: "2026-07-07",
      ultima_execucao_task_id: "76542478",
      proxima_data: "2026-08-07",
    });

    expect(buildPreventivePlanPatch(
      {
        ultima_execucao_data: "2026-07-07",
        ultima_execucao_task_id: "76542478",
        proxima_data: "2026-09-15",
      },
      {
        ultima_preventiva: "2026-07-07",
        ultima_preventiva_task_id: "76542478",
        proxima_preventiva: "2026-08-07",
      },
    )).toBeNull();

    expect(buildPreventivePlanPatch(
      {
        ultima_execucao_data: "2026-08-10",
        ultima_execucao_task_id: "tipo-incorreto",
        proxima_data: "2026-09-15",
      },
      {
        ultima_preventiva: "2026-07-07",
        ultima_preventiva_task_id: "76542478",
        proxima_preventiva: "2026-08-07",
      },
    )).toEqual({
      ultima_execucao_data: "2026-07-07",
      ultima_execucao_task_id: "76542478",
    });
  });

  it("filtra também as tarefas futuras e aguarda a atualização da tela", () => {
    expect(page).toContain("preventiveTaskTypes: [...PREVENTIVA_TASK_TYPE_IDS]");
    expect(page).toContain(".filter(t => isPreventivaTaskType(t.auvo_task_type_id))");
    expect(page).toContain("await Promise.all([");
    expect(page).toContain('["plano-proximas-by-eq"]');
    expect(consolidator).toContain('.in("auvo_task_type_id", PREVENTIVA_TASK_TYPE_IDS)');
    expect(equipmentSync).toContain('new Set(["180175", "180176"])');
    expect(equipmentSync).toContain("allowedPreventiveTaskTypes.has(id)");
  });
});
