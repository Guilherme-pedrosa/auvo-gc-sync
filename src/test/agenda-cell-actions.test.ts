import { describe, expect, it } from "vitest";
import { findManualAgendaEntry, selectFutureContractVisitMoves } from "@/lib/agendaCellActions";

describe("anotação manual da célula", () => {
  it("não toma a identidade de contrato nem tarefa Auvo ao salvar texto livre", () => {
    const plan = { id: "contract", origem: "CONTRATO", previsao_tipo: "CONTRATO", contrato_visita_config_id: "config", auvo_task_id: null };
    const task = { id: "task", origem: "AUVO", auvo_task_id: "100" };
    const continuation = { ...plan, id: "continuation", origem: "MANUAL", previsao_tipo: "CONTINUACAO" };
    expect(findManualAgendaEntry([plan, task, continuation])).toBeUndefined();
    const note = { id: "note", origem: "MANUAL", auvo_task_id: null };
    expect(findManualAgendaEntry([plan, task, note])?.id).toBe("note");
    expect(findManualAgendaEntry([{ ...note, origem: null }])?.id).toBe("note");
  });
});

describe("mover previsão selecionada e futuras", () => {
  const selected = {
    id: "chosen", data: "2026-09-15", colaborador_id: "technician", colaborador_nome: "Técnico",
    previsao_tipo: "CONTRATO", contrato_visita_config_id: "config", contrato_visita_execucao_id: "already-done", status: "CUMPRIDA_NO_MES",
  };
  it("inclui o slot escolhido cumprido mesmo quando a consulta retorna só outros futuros pendentes", () => {
    const pending = { ...selected, id: "pending", data: "2026-10-15", contrato_visita_execucao_id: null, status: "PREVISAO" };
    const otherDone = { ...selected, id: "other-done", data: "2026-10-16" };
    const otherTechnician = { ...pending, id: "other-tech", colaborador_id: "other" };
    const past = { ...pending, id: "past", data: "2026-09-01" };
    const otherContract = { ...pending, id: "other-contract", contrato_visita_config_id: "different" };
    const result = selectFutureContractVisitMoves(selected, [pending, otherDone, otherTechnician, past, otherContract, pending]);
    expect(result).toEqual([selected, pending]);
    expect(result[0]).toBe(selected);
    expect(result.map((item) => ({ id: item.id, date: item.id === selected.id ? "2026-09-17" : item.data })))
      .toEqual([{ id: "chosen", date: "2026-09-17" }, { id: "pending", date: "2026-10-15" }]);
  });
  it("não ignora o item escolhido quando não há outras previsões futuras", () => {
    expect(selectFutureContractVisitMoves(selected, [])).toEqual([selected]);
  });
  it("exclui outra visita cumprida cujo ID de execução ainda não veio", () => {
    const done = { ...selected, id: "another", contrato_visita_execucao_id: null };
    expect(selectFutureContractVisitMoves(selected, [done])).toEqual([selected]);
  });
});
