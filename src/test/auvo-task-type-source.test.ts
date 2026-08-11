import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auvoTaskTypeDescription,
  auvoTaskTypeId,
  isConcreteAuvoTaskTypeDescription,
} from "../../supabase/functions/_shared/auvo-task-type";

const root = resolve(__dirname, "../..");

describe("tipo real da tarefa Auvo na agenda", () => {
  it("lê as variações de ID devolvidas pela API", () => {
    expect(auvoTaskTypeId({ taskType: 180175 })).toBe("180175");
    expect(auvoTaskTypeId({ taskType: { id: 77 } })).toBe("77");
    expect(auvoTaskTypeId({ taskType: { taskTypeID: 88 } })).toBe("88");
    expect(auvoTaskTypeId({ taskTypeID: 99 })).toBe("99");
  });

  it("lê o nome tanto da tarefa quanto do objeto aninhado", () => {
    expect(auvoTaskTypeDescription({ taskTypeDescription: "Visita Preventiva" }))
      .toBe("Visita Preventiva");
    expect(auvoTaskTypeDescription({ taskType: { name: "Execução" } }))
      .toBe("Execução");
    expect(isConcreteAuvoTaskTypeDescription("Tipo 77")).toBe(false);
    expect(isConcreteAuvoTaskTypeDescription("TIPO NÃO INFORMADO")).toBe(false);
    expect(isConcreteAuvoTaskTypeDescription("Chamados Contratuais")).toBe(true);
  });

  it("não usa a ausência de OS do GC como mensagem ou tipo do card", () => {
    const page = readFileSync(resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"), "utf8");
    expect(page).not.toContain("OS do GestãoClick não vinculada");
    expect(page).not.toContain("OS do GC não vinculada");
    expect(page).not.toContain("taskTypeRequiresGcOs");
  });

  it("recupera no detalhe Auvo os poucos tipos ausentes na listagem", () => {
    const agenda = readFileSync(resolve(root, "supabase/functions/auvo-agenda/index.ts"), "utf8");
    expect(agenda).toContain("detailTaskIds.add(tid)");
    expect(agenda).toContain("taskTypeDescription: auvoTaskTypeDescription(r)");
    expect(agenda).toContain("snap?.taskTypeDescription");
  });
});
