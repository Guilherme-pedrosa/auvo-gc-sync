import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { missingAuvoAgendaIds } from "@/lib/agendaAuvoReconciliation";

const root = resolve(__dirname, "../..");
const page = readFileSync(resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"), "utf8");
const edge = readFileSync(resolve(root, "supabase/functions/auvo-agenda/index.ts"), "utf8");

const period = {
  syncComplete: true,
  startDate: "2026-08-10",
  endDate: "2026-11-07",
};

describe("reconciliação das tarefas Auvo na agenda", () => {
  it("remove tarefa Auvo sem vínculo GC que sumiu da resposta completa", () => {
    expect(missingAuvoAgendaIds([
      { id: "dead", auvo_task_id: "100", data: "2026-08-12", origem: "AUVO" },
    ], [], period)).toEqual(["dead"]);
  });

  it("não remove nada quando a paginação da API foi parcial", () => {
    expect(missingAuvoAgendaIds([
      { id: "dead", auvo_task_id: "100", data: "2026-08-12", origem: "AUVO" },
    ], [], { ...period, syncComplete: false })).toEqual([]);
  });

  it("preserva tarefa ainda retornada pela API", () => {
    expect(missingAuvoAgendaIds([
      { id: "alive", auvo_task_id: "100", data: "2026-08-12", origem: "AUVO" },
    ], ["100"], period)).toEqual([]);
  });

  it("preserva vínculos do GC e previsões protegidas", () => {
    const rows = [
      { id: "os", auvo_task_id: "100", data: "2026-08-12", origem: "AUVO", gc_os_codigo: "9999" },
      { id: "orc", auvo_task_id: "101", data: "2026-08-12", origem: "AUVO", gc_orcamento_codigo: "6000" },
      { id: "forecast", auvo_task_id: "102", data: "2026-08-12", origem: "AUVO", previsao_tipo: "ORCAMENTO_EXECUCAO" },
    ];
    expect(missingAuvoAgendaIds(rows, [], period)).toEqual([]);
  });

  it("não mexe em tarefas fora do período sincronizado nem em registros manuais", () => {
    const rows = [
      { id: "past", auvo_task_id: "100", data: "2026-08-09", origem: "AUVO" },
      { id: "manual", auvo_task_id: "101", data: "2026-08-12", origem: "MANUAL" },
    ];
    expect(missingAuvoAgendaIds(rows, [], period)).toEqual([]);
  });

  it("só executa a limpeza quando o backend confirma paginação completa", () => {
    expect(edge).toContain("sync_complete: taskFetch.complete");
    expect(edge).toContain("complete = false");
    expect(page).toContain("missingAuvoAgendaIds(");
    expect(page).toContain("sync_complete === true");
  });
});
