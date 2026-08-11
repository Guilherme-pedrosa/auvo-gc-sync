import { describe, expect, it } from "vitest";
import {
  agendaTaskWorkedTime,
  formatWorkedClock,
  formatWorkedMinutes,
  summarizeAgendaWorkedTime,
} from "@/lib/agendaWorkedTime";

describe("horas efetivamente trabalhadas na agenda", () => {
  it("não transforma duração planejada em trabalho sem check-in", () => {
    expect(agendaTaskWorkedTime({ duracao_decimal: 8 }).minutes).toBe(0);
  });

  it("prioriza a duração oficial do Auvo, que já desconta pausas", () => {
    const worked = agendaTaskWorkedTime({
      check_in_iso: "2026-08-10T08:00:00-03:00",
      check_out_iso: "2026-08-10T12:00:00-03:00",
      duracao_decimal: 3.5,
    });
    expect(worked.minutes).toBe(210);
  });

  it("usa check-in e checkout quando a duração oficial estiver ausente", () => {
    const worked = agendaTaskWorkedTime({
      check_in_iso: "2026-08-10T08:15:00-03:00",
      check_out_iso: "2026-08-10T10:45:00-03:00",
    });
    expect(worked.minutes).toBe(150);
  });

  it("marca check-in aberto sem inventar duração", () => {
    const worked = agendaTaskWorkedTime({ check_in_iso: "2026-08-10T08:00:00-03:00" });
    expect(worked.inProgress).toBe(true);
    expect(worked.minutes).toBe(0);
  });

  it("soma tarefas únicas do técnico no dia", () => {
    const summary = summarizeAgendaWorkedTime([
      { auvo_task_id: "1", check_in_iso: "2026-08-10T08:00:00-03:00", check_out_iso: "2026-08-10T10:00:00-03:00", duracao_decimal: 2 },
      { auvo_task_id: "1", check_in_iso: "2026-08-10T08:00:00-03:00", check_out_iso: "2026-08-10T10:00:00-03:00", duracao_decimal: 2 },
      { auvo_task_id: "2", check_in_iso: "2026-08-10T11:00:00-03:00", check_out_iso: "2026-08-10T12:30:00-03:00", duracao_decimal: 1.5 },
      { auvo_task_id: "3" },
    ]);
    expect(summary).toEqual({ totalMinutes: 210, tasksWithWork: 2, inProgress: 0 });
    expect(formatWorkedMinutes(summary.totalMinutes)).toBe("3h30");
  });

  it("exibe o relógio original do Auvo mesmo gravado com marcação +00", () => {
    const worked = agendaTaskWorkedTime({
      check_in_iso: "2026-08-10T20:34:49+00:00",
      check_out_iso: "2026-08-10T20:37:48+00:00",
      duracao_decimal: 0.0497,
    });
    expect(formatWorkedClock(worked.checkIn)).toBe("20:34");
    expect(formatWorkedClock(worked.checkOut)).toBe("20:37");
  });
});
