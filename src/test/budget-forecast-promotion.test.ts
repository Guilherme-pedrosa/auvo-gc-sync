import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auvoTaskHasStarted,
  forecastDurationMinutes,
  isOsEligibleForBudgetForecast,
  normalizeGcDocumentCode,
  taskAssignedUserId,
  taskStartMinuteKey,
  taskTypeId,
} from "../../supabase/functions/_shared/agenda-forecast-promotion";

const root = resolve(__dirname, "../..");

describe("promoção da previsão do orçamento", () => {
  it("normaliza a chave usada entre orçamento e OS", () => {
    expect(normalizeGcDocumentCode("Orçamento #5.923")).toBe("5923");
  });

  it("preserva a duração planejada inclusive quando cruza meia-noite", () => {
    expect(forecastDurationMinutes("08:00:00", "10:30:00")).toBe(150);
    expect(forecastDurationMinutes("23:00", "01:00")).toBe(120);
  });

  it("bloqueia tarefas iniciadas, pausadas ou finalizadas", () => {
    expect(auvoTaskHasStarted({ checkIn: true })).toBe(true);
    expect(auvoTaskHasStarted({ taskStatus: { description: "Em andamento" } })).toBe(true);
    expect(auvoTaskHasStarted({ finished: true })).toBe(true);
    expect(auvoTaskHasStarted({ taskStatus: { description: "Agendada" } })).toBe(false);
  });

  it("não reaproveita a OS antiga de uma baixa parcial", () => {
    const forecastCreatedAt = "2026-08-10T22:42:36.852Z";

    expect(isOsEligibleForBudgetForecast({
      gc_os_codigo: "9331",
      gc_os_data: "2026-04-14",
      gc_os_situacao: "EXECUTADO COM NOTA EMITIDA",
    }, forecastCreatedAt)).toBe(false);

    expect(isOsEligibleForBudgetForecast({
      gc_os_codigo: "10080",
      gc_os_data: "2026-08-11",
      gc_os_situacao: "AGUARDANDO EXECUÇÃO",
    }, forecastCreatedAt)).toBe(true);
  });

  it("não usa OS finalizada mesmo quando ela é do mesmo dia da previsão", () => {
    expect(isOsEligibleForBudgetForecast({
      gc_os_codigo: "10081",
      gc_os_data: "2026-08-10",
      gc_os_situacao: "EXECUTADO – AGUARDANDO NEGOCIAÇÃO FINANCEIRA",
    }, "2026-08-10T08:00:00Z")).toBe(false);
  });

  it("lê data, técnico e tipo nas variações retornadas pela API Auvo", () => {
    const task = {
      taskDate: "2026-08-24T08:00:00",
      idUserTo: 42,
      taskType: { id: 77 },
    };
    expect(taskStartMinuteKey(task)).toBe("2026-08-24T08:00");
    expect(taskAssignedUserId(task)).toBe(42);
    expect(taskTypeId(task)).toBe(77);
    expect(taskTypeId({ taskType: { taskTypeID: 78 } })).toBe(78);
    expect(taskTypeId({ taskTypeID: 79 })).toBe(79);
  });

  it("mantém o número do orçamento mesmo quando a tarefa já possui OS", () => {
    const auvoAgenda = readFileSync(resolve(root, "supabase/functions/auvo-agenda/index.ts"), "utf8");
    const agendaPage = readFileSync(resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"), "utf8");
    expect(auvoAgenda).not.toContain("localDocument?.gc_os_codigo\n          ? null");
    expect(agendaPage).not.toContain("gc_orcamento_codigo: osCodigo ? null : orcCodigo");
    expect(auvoAgenda).toContain("gc_os_orcamento_codigo");
  });

  it("promove a mesma linha e elimina apenas a duplicata da tarefa", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260810180000_promote_budget_forecast.sql"),
      "utf8",
    );
    expect(migration).toContain("WHERE id = p_previsao_id");
    expect(migration).toContain("auvo_task_id = v_task");
    expect(migration).toContain("id <> p_previsao_id");
    expect(migration).toContain("previsao_continuidade = false");
  });

  it("aplica a trava nas duas rotas automáticas e na conversão final", () => {
    const centralSync = readFileSync(resolve(root, "supabase/functions/central-sync/index.ts"), "utf8");
    const auvoAgenda = readFileSync(resolve(root, "supabase/functions/auvo-agenda/index.ts"), "utf8");
    const taskUpdate = readFileSync(resolve(root, "supabase/functions/auvo-task-update/index.ts"), "utf8");

    expect(centralSync).toContain("isOsEligibleForBudgetForecast(os, forecast.criado_em)");
    expect(centralSync).toContain("gc_os_codigo: null");
    expect(auvoAgenda).toContain("isOsEligibleForBudgetForecast(task, forecast.criado_em)");
    expect(taskUpdate).toContain('reason: "stale_os"');
  });
});
