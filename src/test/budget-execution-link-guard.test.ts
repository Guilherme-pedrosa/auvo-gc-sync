import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as helpers from "../../supabase/functions/_shared/agenda-forecast-promotion";

const executionId = "79721161";
const diagnosticId = "77509677";
const expected = { budgetCode: "6563", osCode: "10234", taskId: executionId };
const rawOrder = {
  id: "398336240", codigo: "10234", nome_cliente: "AMBEV",
  nome_situacao: "PEDIDO CONFERIDO - AGUARDANDO EXECUÇÃO", data_entrada: "2026-09-01",
  atributos: [
    { atributo: { atributo_id: "81831", conteudo: "6563" } },
    { atributo: { atributo_id: "73344", conteudo: executionId } },
    { atributo: { atributo_id: "73343", conteudo: diagnosticId } },
  ],
};
const rawBudget = { codigo: "6563", situacao_id: "7109779", nome_situacao: "APROVADO - OS GERADA" };
const gcEnvelope = (orders: any[] = [rawOrder]) => ({ data: { status: 200, stale: false, data: { data: orders } }, error: null });

describe("vínculo explícito da execução do orçamento", () => {
  it("deduplica IDs do atributo execução sem aceitar números inválidos", () => {
    expect(helpers.explicitExecutionTaskIds(` ${executionId} / ${executionId}; 0 / 123 / ${diagnosticId}`))
      .toEqual([executionId, diagnosticId]);
  });

  it("OS 10234 aceita execução 79721161 e rejeita o diagnóstico 77509677", () => {
    const row = helpers.mapGcOsBudgetExecutionLink(rawOrder);
    expect(helpers.validateBudgetExecutionTaskLink([row], expected)).toMatchObject({ valid: true });
    expect(helpers.validateBudgetExecutionTaskLink([row], { ...expected, taskId: diagnosticId }))
      .toEqual({ valid: false, reason: "execution_mismatch" });
    expect(helpers.isOsEligibleForBudgetForecast(row, "2026-09-08")).toBe(true);
  });

  it("aceita a mesma tarefa nos dois atributos quando também é execução explícita", () => {
    const row = { ...helpers.mapGcOsBudgetExecutionLink(rawOrder), gc_os_tarefa_os: executionId };
    expect(helpers.validateBudgetExecutionTaskLink([row], expected).valid).toBe(true);
  });

  it("não promove diagnóstico quando o campo execução está vazio", () => {
    const row = { ...helpers.mapGcOsBudgetExecutionLink(rawOrder), gc_os_tarefa_exec: "" };
    expect(helpers.validateBudgetExecutionTaskLink([row], { ...expected, taskId: diagnosticId }))
      .toEqual({ valid: false, reason: "execution_not_linked" });
  });

  it("exige os dois documentos corretos e uma única execução", () => {
    const row = helpers.mapGcOsBudgetExecutionLink(rawOrder);
    expect(helpers.validateBudgetExecutionTaskLink([row], { ...expected, budgetCode: "6605" }).reason).toBe("budget_mismatch");
    expect(helpers.validateBudgetExecutionTaskLink([row], { ...expected, osCode: "10239" }).reason).toBe("os_not_found");
    expect(helpers.validateBudgetExecutionTaskLink([{ ...row, gc_os_tarefa_exec: `${executionId}/${diagnosticId}` }], expected).reason)
      .toBe("ambiguous_execution");
    expect(helpers.validateBudgetExecutionTaskLink([row, { ...row, gc_os_tarefa_exec: diagnosticId }], expected).reason)
      .toBe("ambiguous_execution");
  });

  it("lê atributos planos e exige confirmação fresca do GC", async () => {
    const invoke = vi.fn(async (_name, { body }) => gcEnvelope(body.endpoint.includes("/orcamentos?")
      ? [rawBudget] : [{ ...rawOrder, atributos: rawOrder.atributos.map(a => a.atributo) }]));
    expect((await helpers.readBudgetExecutionTaskLink(invoke, expected)).valid).toBe(true);
    expect(invoke).toHaveBeenCalledWith("gc-proxy", { body: {
      endpoint: "/api/ordens_servicos?codigo=10234&limite=5", method: "GET", source: "budget-forecast", force_refresh: true,
    } });
  });

  it.each([
    { data: { ...gcEnvelope().data, stale: true }, error: null },
    { data: { ...gcEnvelope().data, status: 429 }, error: null },
    { data: { ...gcEnvelope().data, status: undefined }, error: null },
    { data: null, error: { message: "GC indisponível" } },
    { data: { status: 200, data: { data: {} } }, error: null },
    { data: { status: 200, data: { data: [rawOrder], meta: { total_paginas: 2 } } }, error: null },
  ])("leitura não confirmada não autoriza reagendamento: %j", async (response) => {
    await expect(helpers.readBudgetExecutionTaskLink(vi.fn().mockResolvedValue(response), expected)).rejects.toThrow(/GC/);
  });

  it("tarefa aberta sem data não é execução iniciada; status numérico iniciado é", () => {
    expect(helpers.auvoTaskHasStarted({ taskStatus: 1, taskDate: "0001-01-01", checkInDate: "0001-01-01T00:00:00" })).toBe(false);
    for (const status of [2, 3, 4, 5, 6]) expect(helpers.auvoTaskHasStarted({ taskStatus: status })).toBe(true);
  });

  it("espelha execução nova com cliente Auvo, tipo verificado e zero horas trabalhadas", () => {
    const row = helpers.promotedExecutionMirrorRow({
      taskID: Number(executionId), taskDate: "2026-09-17T08:00:00", idUserTo: 184612,
      taskStatus: 1, taskType: 246203, estimatedDuration: "02:00:00", duration: "00:00:00",
      customerDescription: "FILIAL CEBRASA", orientation: "Executar serviço aprovado",
    }, helpers.mapGcOsBudgetExecutionLink(rawOrder), "Fred", "EXECUÇÃO - 2h");
    expect(row).toMatchObject({
      mirror_key: `${executionId}::os:398336240::orc:`, gc_os_codigo: "10234", gc_orcamento_codigo: "6563",
      cliente: "FILIAL CEBRASA", gc_os_cliente: "AMBEV", tecnico_id: "184612", tecnico: "Fred",
      data_tarefa: "2026-09-17", hora_inicio: "08:00", hora_fim: null,
      task_type_id: 246203, descricao: "EXECUÇÃO - 2h", duracao_decimal: 0,
      check_in: false, check_out: false,
    });
  });

  it("o espelho usa horas reais com pausa, sem somar duração planejada", () => {
    const row = helpers.promotedExecutionMirrorRow({
      taskID: executionId, taskDate: "2026-09-17T08:00:00", idUserTo: 184612,
      checkInDate: "2026-09-17T08:15:00", checkOutDate: "2026-09-17T09:15:00",
      timeControl: [{ pauseStart: "2026-09-17T08:30:00", pauseEnd: "2026-09-17T08:45:00" }], estimatedDuration: "02:00:00",
    }, helpers.mapGcOsBudgetExecutionLink(rawOrder), "Fred");
    expect(row.duracao_decimal).toBe(0.75);
    expect(row.hora_inicio).toBe("08:15");
    expect(row.hora_fim).toBe("09:15");
  });
});

// Execute the actual edge handler body with provider/DB dependencies injected.
// No Deno server, login or network request runs in this regression test.
const edgeSource = readFileSync(resolve(__dirname, "../../supabase/functions/auvo-task-update/index.ts"), "utf8");
const handlerSource = edgeSource.slice(edgeSource.indexOf("async function promoteBudgetForecast("), edgeSource.indexOf("\nfunction hasOwn("));
const compiledHandler = ts.transpile(handlerSource, { target: ts.ScriptTarget.ES2022 });
const forecast = { id: "75a7006a", gc_orcamento_codigo: "6563", previsao_continuidade: true, previsao_tipo: "ORCAMENTO_EXECUCAO",
  data: "2026-09-17", hora_inicio: "08:00:00", hora_fim: "10:00:00", colaborador_id: "rh-fred", criado_em: "2026-09-08" };

function promotionHarness(providerResult = gcEnvelope(), budget = rawBudget, latestForecast: any = forecast) {
  const writes: Array<{ kind: string; value?: any }> = [];
  const invoke = vi.fn(async (_name, { body }) => body.endpoint.includes("/orcamentos?") ? gcEnvelope([budget]) : providerResult);
  let agendaReads = 0;
  const admin = {
    functions: { invoke },
    from: vi.fn((table: string) => {
      const query: any = {
        select: () => query, eq: () => query, is: () => query,
        maybeSingle: async () => ({ data: table === "agenda_agendamentos" ? (++agendaReads === 1 ? forecast : latestForecast) : { id: "rh-fred", nome: "Fred", auvo_user_id: 184612 }, error: null }),
        update: (value: any) => { writes.push({ kind: `update:${table}`, value }); return query; },
        single: async () => ({ data: { ...forecast, previsao_continuidade: false, auvo_task_id: executionId }, error: null }),
        upsert: async (value: any) => { writes.push({ kind: `upsert:${table}`, value }); return { error: null }; },
      };
      return query;
    }),
    rpc: vi.fn(async (_name, args) => { writes.push({ kind: "promote", value: args }); return { data: [forecast], error: null }; }),
  };
  const initialTask = { taskID: Number(executionId), taskDate: "0001-01-01T00:00:00", idUserTo: 0, taskType: 180177, taskStatus: 1 };
  const verifiedTask = { ...initialTask, taskDate: "2026-09-17T08:00:00", idUserTo: 184612, taskType: 246203, customerDescription: "FILIAL CEBRASA" };
  const fetchTaskById = vi.fn().mockResolvedValueOnce(initialTask).mockResolvedValueOnce(verifiedTask);
  const ensureTaskTypeDuration = vi.fn().mockResolvedValue({ id: 246203, description: "EXECUÇÃO - 2h" });
  const patchWithRetry = vi.fn().mockResolvedValue({ ok: true, text: async () => "{}" });
  const markForecastConversion = vi.fn().mockResolvedValue(true);
  const dependencies = { ...helpers, fetchTaskById, ensureTaskTypeDuration, patchWithRetry, markForecastConversion, AUVO_BASE_URL: "https://test.auvo.invalid" };
  const handler = new Function(...Object.keys(dependencies), `${compiledHandler}; return promoteBudgetForecast;`)(...Object.values(dependencies));
  return { run: (body = { gcOrcamentoCodigo: "6563", gcOsCodigo: "10234", execTaskId: executionId }) => handler(admin, {}, body, "test"),
    writes, admin, fetchTaskById, ensureTaskTypeDuration, patchWithRetry, markForecastConversion };
}

describe("promoção real com provedores simulados", () => {
  it.each([
    { ...rawBudget, situacao_id: "9348312" },
    { ...rawBudget, nome_situacao: "Aprovado - Baixa Parcial" },
  ])("reserva antiga cujo orçamento virou baixa parcial não toca a execução antiga", async (budget) => {
    const test = promotionHarness(gcEnvelope(), budget);
    expect(await test.run()).toMatchObject({ promoted: false, reason: "partial_balance" });
    expect(test.fetchTaskById).not.toHaveBeenCalled();
    expect(test.patchWithRetry).not.toHaveBeenCalled();
    expect(test.admin.rpc).not.toHaveBeenCalled();
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0].value).toMatchObject({ previsao_tipo: "SALDO_BAIXA_PARCIAL", conversao_status: "SALDO_A_CONFIRMAR" });
    expect(test.writes[0].value).not.toHaveProperty("data");
    expect(test.writes[0].value).not.toHaveProperty("colaborador_id");
    expect(test.admin.functions.invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...forecast, previsao_tipo: "SALDO_BAIXA_PARCIAL" },
    { ...forecast, previsao_continuidade: false, auvo_task_id: executionId },
    { ...forecast, data: "2026-09-18" },
    { ...forecast, colaborador_id: "outro-tecnico" },
  ])("preserva reserva alterada durante a leitura GC: %j", async (latestForecast) => {
    const test = promotionHarness(gcEnvelope(), rawBudget, latestForecast);
    expect(await test.run()).toMatchObject({ promoted: false, reason: "forecast_changed" });
    expect(test.fetchTaskById).not.toHaveBeenCalled();
    expect(test.patchWithRetry).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it("não consulta nem altera tarefa diagnóstica enviada por um sincronizador antigo", async () => {
    const test = promotionHarness();
    expect(await test.run({ gcOrcamentoCodigo: "6563", gcOsCodigo: "10234", execTaskId: diagnosticId }))
      .toMatchObject({ promoted: false, reason: "execution_mismatch" });
    expect(test.fetchTaskById).not.toHaveBeenCalled();
    expect(test.ensureTaskTypeDuration).not.toHaveBeenCalled();
    expect(test.patchWithRetry).not.toHaveBeenCalled();
    expect(test.admin.rpc).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it("preserva a reserva e não toca Auvo quando GC devolve cache antigo", async () => {
    const test = promotionHarness({ ...gcEnvelope(), data: { ...gcEnvelope().data, stale: true } });
    expect(await test.run()).toMatchObject({ promoted: false, reason: "gc_link_unconfirmed" });
    expect(test.fetchTaskById).not.toHaveBeenCalled();
    expect(test.patchWithRetry).not.toHaveBeenCalled();
    expect(test.writes).toEqual([]);
  });

  it("agenda execução sem técnico/data, insere espelho factual e promove a mesma reserva", async () => {
    const test = promotionHarness();
    expect(await test.run()).toMatchObject({ promoted: true, forecastId: forecast.id });
    expect(test.patchWithRetry).toHaveBeenCalledTimes(1);
    const patch = JSON.parse(test.patchWithRetry.mock.calls[0][1].body);
    expect(patch).toEqual([
      { op: "replace", path: "/taskDate", value: "2026-09-17T08:00:00" },
      { op: "replace", path: "/idUserTo", value: 184612 },
      { op: "replace", path: "/taskType", value: 246203 },
    ]);
    expect(test.writes.map(write => write.kind)).toEqual(["upsert:tarefas_central", "promote", "update:agenda_agendamentos"]);
    expect(test.writes[0].value).toMatchObject({ auvo_task_id: executionId, duracao_decimal: 0, cliente: "FILIAL CEBRASA", task_type_id: 246203 });
    expect(test.admin.rpc).toHaveBeenCalledWith("promover_previsao_orcamento", {
      p_previsao_id: forecast.id, p_orcamento_codigo: "6563", p_os_codigo: "10234", p_auvo_task_id: executionId,
    });
  });
});
