import { describe, expect, it } from "vitest";
import {
  cleanAuvoTaskTypeDescription,
  resolveAgendaTaskType,
  taskTypeRequiresGcOs,
} from "@/lib/agendaTaskType";

describe("tipo da tarefa no Agendamento Equipe", () => {
  it("reconhece os dois tipos preventivos oficiais", () => {
    expect(resolveAgendaTaskType({ taskTypeId: "180175" })).toBe("PREVENTIVA");
    expect(resolveAgendaTaskType({ taskTypeId: "180176" })).toBe("PREVENTIVA");
  });

  it("remove o prefixo gerenciado de duração sem perder o tipo", () => {
    const description = "[WEDO:180176:120] Visita Preventiva Contrato · 2h";
    expect(cleanAuvoTaskTypeDescription(description)).toBe("Visita Preventiva Contrato");
    expect(resolveAgendaTaskType({ taskTypeDescription: description })).toBe("PREVENTIVA");
  });

  it("identifica execução pelo tipo do Auvo", () => {
    expect(resolveAgendaTaskType({ taskTypeDescription: "Visita de Execução" })).toBe("EXECUÇÃO");
  });

  it("usa 73344 como fallback para tarefa de execução", () => {
    expect(resolveAgendaTaskType({
      taskId: "72509298",
      gcExecutionTaskIds: "72509298/72509300",
    })).toBe("EXECUÇÃO");
  });

  it("usa 73343 como fallback para tarefa OS", () => {
    expect(resolveAgendaTaskType({ taskId: "77898022", gcOsTaskIds: "77898022" })).toBe("OS");
  });

  it("mostra o nome real de um tipo personalizado, nunca SEM OS", () => {
    expect(resolveAgendaTaskType({ taskTypeDescription: "Instalação técnica" }))
      .toBe("INSTALAÇÃO TÉCNICA");
    expect(resolveAgendaTaskType({})).toBe("TIPO NÃO INFORMADO");
  });

  it("só libera preventiva contratual sem vínculo de OS", () => {
    expect(taskTypeRequiresGcOs("Visita Preventiva Contrato", "PREVENTIVA")).toBe(false);
    expect(taskTypeRequiresGcOs(null, "PREVENTIVA", "180176")).toBe(false);
    expect(taskTypeRequiresGcOs("Visita Preventiva + OS", "PREVENTIVA")).toBe(true);
    expect(taskTypeRequiresGcOs("Visita de Execução", "EXECUÇÃO")).toBe(true);
  });
});
