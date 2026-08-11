import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  formatSignedAgendaMinutes,
  summarizeAgendaOsPlannedVsActual,
} from "@/lib/agendaPlannedVsActual";

const root = resolve(__dirname, "../..");
const page = readFileSync(resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260811013000_agenda_planned_duration.sql"),
  "utf8",
);
const incremental = readFileSync(resolve(root, "src/lib/agendaIncrementalSync.ts"), "utf8");

describe("planejado x real diário das OS", () => {
  it("soma somente duração planejada de itens vinculados a OS", () => {
    const summary = summarizeAgendaOsPlannedVsActual([
      { id: "os", gc_os_codigo: "1001", duracao_planejada_minutos: 120 },
      { id: "preventiva", duracao_planejada_minutos: 480 },
      { id: "sem-plano", gc_os_codigo: "1002", duracao_planejada_minutos: null },
    ]);

    expect(summary.plannedMinutes).toBe(120);
    expect(summary.plannedOsCount).toBe(1);
  });

  it("não compara tarefa pendente como se o real fosse zero", () => {
    const summary = summarizeAgendaOsPlannedVsActual([
      { id: "pendente", gc_os_codigo: "1001", duracao_planejada_minutos: 180 },
    ]);

    expect(summary.plannedMinutes).toBe(180);
    expect(summary.actualCompletedMinutes).toBe(0);
    expect(summary.comparedPlannedMinutes).toBe(0);
    expect(summary.pendingOsCount).toBe(1);
    expect(summary.differenceMinutes).toBe(0);
  });

  it("compara apenas OS concluídas e mantém as pendentes no total planejado", () => {
    const summary = summarizeAgendaOsPlannedVsActual([
      {
        id: "concluida",
        gc_os_codigo: "1001",
        duracao_planejada_minutos: 120,
        check_in_iso: "2026-08-10T08:00:00Z",
        check_out_iso: "2026-08-10T09:30:00Z",
        duracao_decimal: 1.5,
      },
      { id: "pendente", gc_os_codigo: "1002", duracao_planejada_minutos: 180 },
    ]);

    expect(summary.plannedMinutes).toBe(300);
    expect(summary.comparedPlannedMinutes).toBe(120);
    expect(summary.actualCompletedMinutes).toBe(90);
    expect(summary.completedOsCount).toBe(1);
    expect(summary.pendingOsCount).toBe(1);
    expect(summary.differenceMinutes).toBe(-30);
  });

  it("não duplica uma OS que apareça em mais de uma tarefa", () => {
    const summary = summarizeAgendaOsPlannedVsActual([
      { id: "task-os", gc_os_codigo: "1001", duracao_planejada_minutos: 120 },
      {
        id: "task-exec",
        gc_os_codigo: "1001",
        tipo_tarefa_auvo: "EXECUÇÃO",
        duracao_planejada_minutos: 120,
        check_in_iso: "2026-08-10T08:00:00Z",
        check_out_iso: "2026-08-10T10:10:00Z",
        duracao_decimal: 130 / 60,
      },
    ]);

    expect(summary.plannedMinutes).toBe(120);
    expect(summary.plannedOsCount).toBe(1);
    expect(summary.actualCompletedMinutes).toBe(130);
    expect(summary.differenceMinutes).toBe(10);
  });

  it("formata economia, excesso e igualdade", () => {
    expect(formatSignedAgendaMinutes(-30)).toBe("−30min");
    expect(formatSignedAgendaMinutes(75)).toBe("+1h15");
    expect(formatSignedAgendaMinutes(0)).toBe("no previsto");
  });

  it("persiste o plano separado do horário real durante a sincronização", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS duracao_planejada_minutos integer");
    expect(page).toContain("t.duracao_estimada_minutos");
    expect(incremental).toContain('"duracao_planejada_minutos"');
    expect(page).toContain("Planejado OS:");
    expect(page).toContain("OS executadas:");
  });
});
