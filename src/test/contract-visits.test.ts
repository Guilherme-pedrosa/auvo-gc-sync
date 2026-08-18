import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addMinutesToClock,
  buildContractVisitForecasts,
  buildContractYearForecasts,
  contractVisitDurationMinutes,
  eligibleContractVisitDates,
  evenlyDistributedDates,
  isFieldTechnician,
  minimumContractVisitsPerMonth,
  rotatingVisitTeams,
  summarizeContractVisitMonth,
} from "@/lib/contractVisits";

describe("planejamento anual de visitas contratuais", () => {
  const root = resolve(__dirname, "../..");

  it("calcula a carga da visita pelas horas, visitas e pessoas da planilha", () => {
    expect(contractVisitDurationMinutes(32, 2, 2)).toBe(480);
    expect(contractVisitDurationMinutes(24, 3, 1)).toBe(480);
    expect(minimumContractVisitsPerMonth(24, 1)).toBe(3);
    expect(minimumContractVisitsPerMonth(24, 2)).toBe(2);
    expect(() => contractVisitDurationMinutes(24, 2, 1)).toThrow("CARGA_VISITA_EXCEDE_8H");
  });

  it("respeita semanas e dias permitidos", () => {
    expect(eligibleContractVisitDates("2026-09", [2, 3], null, null, [1, 2]))
      .toEqual(["2026-09-01", "2026-09-02", "2026-09-08", "2026-09-09"]);
  });

  it("distribui as visitas pelo mês", () => {
    const eligible = eligibleContractVisitDates("2026-09", [1, 2, 3, 4, 5]);
    expect(evenlyDistributedDates(eligible, 3)).toEqual([
      "2026-09-01",
      "2026-09-16",
      "2026-09-30",
    ]);
  });

  it("nunca coloca duas visitas em dias seguidos da mesma semana", () => {
    const forecasts = buildContractVisitForecasts({
      competencia: "2026-08",
      qtdVisitas: 2,
      qtdTecnicos: 2,
      horasMesContratadas: 32,
      horaInicio: "08:00",
      tecnicoIds: ["a", "b"],
      diasSemana: [2, 3],
      semanasMes: [1, 2],
      naoAntesDe: "2026-08-10",
    });
    expect(forecasts.map((forecast) => forecast.data)).toEqual(["2026-08-11", "2026-08-18"]);
  });

  it("amarra duas visitas às semanas 2 e 4", () => {
    const forecasts = buildContractVisitForecasts({
      competencia: "2026-09",
      qtdVisitas: 2,
      qtdTecnicos: 1,
      horasMesContratadas: 16,
      horaInicio: "08:00",
      tecnicoIds: ["a"],
      diasSemana: [2, 3],
      semanasMes: [2, 4],
    });
    expect(forecasts.map((forecast) => forecast.data)).toEqual(["2026-09-08", "2026-09-22"]);
  });

  it("ignora semanas inexistentes ou já passadas sem bloquear o contrato semanal", () => {
    const currentMonth = buildContractVisitForecasts({
      competencia: "2026-08",
      qtdVisitas: 4,
      qtdTecnicos: 1,
      horasMesContratadas: 32,
      horaInicio: "08:00",
      tecnicoIds: ["a"],
      diasSemana: [2],
      semanasMes: [1, 2, 3, 4, 5],
      naoAntesDe: "2026-08-10",
    });
    expect(currentMonth.map((forecast) => forecast.data)).toEqual([
      "2026-08-11",
      "2026-08-18",
      "2026-08-25",
    ]);

    const fullMonth = buildContractVisitForecasts({
      competencia: "2026-09",
      qtdVisitas: 4,
      qtdTecnicos: 1,
      horasMesContratadas: 32,
      horaInicio: "08:00",
      tecnicoIds: ["a"],
      diasSemana: [2],
      semanasMes: [1, 2, 3, 4, 5],
    });
    expect(fullMonth.map((forecast) => forecast.data)).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
    ]);
  });

  it("preserva todos os slots programados mesmo quando uma visita já foi realizada", () => {
    const forecasts = buildContractVisitForecasts({
      competencia: "2026-09",
      qtdVisitas: 3,
      qtdTecnicos: 1,
      horasMesContratadas: 24,
      horaInicio: "08:00",
      tecnicoIds: ["a"],
      diasSemana: [1, 2, 3, 4, 5],
      visitasRealizadas: [1],
      naoAntesDe: "2026-09-10",
    });
    expect(forecasts.map((forecast) => forecast.visitaNumero)).toEqual([1, 2, 3]);
    expect(forecasts.every((forecast) => forecast.data >= "2026-09-10")).toBe(true);
  });

  it("gera o restante do ano inteiro dentro da vigência", () => {
    const forecasts = buildContractYearForecasts({
      ano: 2026,
      qtdVisitas: 2,
      qtdTecnicos: 2,
      horasMesContratadas: 32,
      horaInicio: "08:00",
      tecnicoIds: ["a", "b"],
      diasSemana: [2, 3],
      semanasMes: [1, 3],
      vigenciaInicio: "2026-10-01",
      vigenciaFim: "2026-12-31",
    });
    expect(new Set(forecasts.map((forecast) => forecast.competencia))).toEqual(new Set(["2026-10", "2026-11", "2026-12"]));
    expect(forecasts).toHaveLength(6);
    expect(forecasts.every((forecast) => forecast.horaFim === "16:00")).toBe(true);
  });

  it("faz rodízio quando há mais técnicos habilitados que pessoas por visita", () => {
    expect(rotatingVisitTeams(["a", "b", "c"], 2, 3)).toEqual([
      ["a", "b"],
      ["c", "a"],
      ["b", "c"],
    ]);
  });

  it("alerta falta e excesso comparando visitas e horas", () => {
    const missing = summarizeContractVisitMonth({
      competencia: "2026-09",
      visitasContratadas: 2,
      horasContratadas: 32,
      forecasts: [
        { contrato_visita_numero: 1, hora_inicio: "08:00", hora_fim: "16:00" },
        { contrato_visita_numero: 1, hora_inicio: "08:00", hora_fim: "16:00" },
      ],
    });
    expect(missing.status).toBe("FALTANDO");

    const excess = summarizeContractVisitMonth({
      competencia: "2026-09",
      visitasContratadas: 1,
      horasContratadas: 8,
      forecasts: [
        { contrato_visita_numero: 1, hora_inicio: "08:00", hora_fim: "16:00" },
        { contrato_visita_numero: 2, hora_inicio: "08:00", hora_fim: "16:00" },
      ],
    });
    expect(excess.status).toBe("EXCEDENTE");
  });

  it("abate visitas e horas reais sem contar novamente a previsao substituida", () => {
    const summary = summarizeContractVisitMonth({
      competencia: "2026-08",
      visitasContratadas: 2,
      horasContratadas: 24,
      forecasts: [
        { contrato_visita_numero: 2, hora_inicio: "08:00", hora_fim: "14:00" },
        { contrato_visita_numero: 2, hora_inicio: "08:00", hora_fim: "14:00" },
      ],
      executions: [
        { visita_numero: 1, horas_trabalhadas: 5.5 },
      ],
    });

    expect(summary.visitasRealizadas).toBe(1);
    expect(summary.visitasPlanejadas).toBe(1);
    expect(summary.visitasPrevistas).toBe(2);
    expect(summary.horasRealizadas).toBe(5.5);
    expect(summary.horasRestantes).toBe(18.5);
    expect(summary.status).toBe("FALTANDO");
  });

  it("mantem a amarracao contratual no banco e deduplica tarefas Auvo", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260817234500_reconcile_contract_visits_with_real_tasks.sql"),
      "utf8",
    );
    expect(migration).toContain("contratos_visitas_execucoes");
    expect(migration).toContain("PARTITION BY tc.auvo_task_id");
    expect(migration).toContain("contratos_visitas_execucao_cliente_dia_unique");
    expect(migration).toContain("reconciliar_dia_visita_contratual");
    expect(migration).toContain("card de previsao deixa");
  });

  it("converte o card previsto em realizado sem criar uma faixa paralela", () => {
    const agendaPage = readFileSync(
      resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"),
      "utf8",
    );
    const cardMigration = readFileSync(
      resolve(root, "supabase/migrations/20260818013000_convert_contract_forecast_card_to_realized.sql"),
      "utf8",
    );

    expect(cardMigration).toContain("materializar_card_visita_contratual");
    expect(cardMigration).toContain("previsao_tipo = 'CONTRATO_REALIZADO'");
    expect(cardMigration).toContain("previsao_continuidade = false");
    expect(cardMigration).toContain("duracao_planejada_minutos = NULL");
    expect(agendaPage).toContain('a.previsao_tipo === "CONTRATO_REALIZADO"');
    expect(agendaPage).toContain("ª VISITA · REALIZADA");
    expect(agendaPage).toContain("bg-violet-100 text-violet-900 border-violet-500");
    expect(agendaPage).not.toContain("Visitas contratuais realizadas");
  });

  it("alinha visitas futuras aos clientes, tarefas e técnicos realmente agendados", () => {
    const agendaPage = readFileSync(
      resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"),
      "utf8",
    );
    const scheduledMigration = readFileSync(
      resolve(root, "supabase/migrations/20260818023000_sync_scheduled_contract_visit_cards.sql"),
      "utf8",
    );

    expect(scheduledMigration).toContain("reconciliar_dia_visita_contratual_agendada");
    expect(scheduledMigration).toContain("contrato_visita_tarefa_ids");
    expect(scheduledMigration).toContain("visita extra alem das");
    expect(scheduledMigration).toContain("generate_series(1, v_config.qtd_visitas)");
    expect(scheduledMigration).toContain("trg_tarefa_reconciliar_visita_contratual_agendada");
    expect(agendaPage).toContain('visitaContratualCumprida ? "REALIZADA NO MÊS" : "PROGRAMADA"');
    expect(agendaPage).toContain("bg-sky-100 text-sky-950 border-sky-500");
  });

  it("separa contratos comuns de contratos de limpeza de coifa usando RH Clientes", () => {
    const scopedMigration = readFileSync(
      resolve(root, "supabase/migrations/20260818033000_scope_contract_visits_by_client_and_activity.sql"),
      "utf8",
    );

    expect(scopedMigration).toContain("clientes_rh_relacionados");
    expect(scopedMigration).toContain("atividade_e_limpeza_coifa");
    expect(scopedMigration).toContain("contrato_e_limpeza_coifa");
    expect(scopedMigration).toContain("public.rh_clientes");
    expect(scopedMigration).toContain("= public.contrato_e_limpeza_coifa(c.nome)");
    expect(scopedMigration).toContain("\\[WEDO:180795:");
    expect(scopedMigration).toContain("p_questionario_id");
    expect(scopedMigration).toContain("215148");
  });

  it("contabiliza contratos pela matriz exata de questionário e tipo do contrato", () => {
    const matrixMigration = readFileSync(
      resolve(root, "supabase/migrations/20260818150000_contract_questionnaire_accounting_matrix.sql"),
      "utf8",
    );
    const agendaPage = readFileSync(
      resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"),
      "utf8",
    );

    expect(matrixMigration).toContain("215148");
    expect(matrixMigration).toContain("224444");
    expect(matrixMigration).toContain("contrato_tipos");
    expect(matrixMigration).toContain("contrato.tipo_id");
    expect(matrixMigration).not.toContain("p_task_type_id, '') = '180795'");
    expect(agendaPage).toContain("Contrato seguido:");
    expect(agendaPage).toContain("contrato_tipo_nome");
  });

  it("não recalcula visitas em toda atualização técnica da sincronização", () => {
    const performanceMigration = readFileSync(
      resolve(root, "supabase/migrations/20260818153000_optimize_contract_visit_sync.sql"),
      "utf8",
    );

    expect(performanceMigration).toContain("idx_rh_clientes_nome_vinculado_normalizado");
    expect(performanceMigration).toContain("OLD.questionario_id IS NOT DISTINCT FROM NEW.questionario_id");
    expect(performanceMigration).toContain("OLD.questionario_respostas IS NOT DISTINCT FROM NEW.questionario_respostas");
    expect(performanceMigration).toContain("OLD.cliente IS DISTINCT FROM NEW.cliente");
    expect(performanceMigration).not.toMatch(/UPDATE OF[^;]*atualizado_em/);
  });

  it("não bloqueia a tela recalculando o ano contratual em uma única consulta", () => {
    const page = readFileSync(
      resolve(root, "src/pages/agendamento/VisitasContratuaisPage.tsx"),
      "utf8",
    );
    const periodMigration = readFileSync(
      resolve(root, "supabase/migrations/20260818154500_optimize_contract_period_reconciliation.sql"),
      "utf8",
    );

    expect(page).toContain("reconcileContractVisitsInDailyBatches");
    expect(page).toContain("p_fim: cursor");
    expect(page).not.toContain("Apenas reconcilia se for o ano atual");
    expect(periodMigration).toContain("task_clients AS MATERIALIZED");
    expect(periodMigration).toContain("contract_clients AS MATERIALIZED");
    expect(periodMigration).not.toContain("clientes_rh_relacionados(c.cliente_nome, task.cliente)");
  });

  it("mantém o card na data programada e anota a execução real sem duplicá-lo", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260818183000_preserve_scheduled_contract_visit_after_execution.sql"),
      "utf8",
    );
    const agendaPage = readFileSync(
      resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"),
      "utf8",
    );

    expect(migration).toContain("NEW.status := 'CUMPRIDA_NO_MES'");
    expect(migration).toContain("Visita já realizada neste mês em %s");
    expect(migration).toContain("SET atualizado_em = now()");
    expect(migration).not.toContain("SET data = v_exec.data_realizada");
    expect(migration).toContain("OLD.previsao_tipo = 'CONTRATO_REALIZADO'");
    expect(migration).toContain("RETURN OLD");
    expect(agendaPage).toContain("JÁ CUMPRIDO NO MÊS:");
    expect(agendaPage).toContain("disponíveis");
    expect(agendaPage).toContain("bg-emerald-100 text-emerald-950");
  });

  it("impede dois cards do mesmo contrato, visita e técnico", () => {
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260818190000_deduplicate_contract_visit_slots.sql"),
      "utf8",
    );

    expect(migration).toContain("DROP TRIGGER IF EXISTS trg_proteger_card_visita_contratual_realizada");
    expect(migration).toContain("agenda_contrato_slot_tecnico_unique");
    expect(migration).toContain("agenda.descricao ILIKE '%tarefas Auvo%'");
    expect(migration).toContain("duplicate.position > 1");
  });

  it("amarra a Hypermarcas pelo RH e consome a primeira visita livre", () => {
    const sequenceMigration = readFileSync(
      resolve(root, "supabase/migrations/20260818160000_fix_contract_visit_sequence_and_hypermarcas_link.sql"),
      "utf8",
    );

    expect(sequenceMigration).toContain("trg_normalizar_numero_nova_visita_contratual");
    expect(sequenceMigration).toContain("v_primeiro_numero_livre");
    expect(sequenceMigration).toContain("SODEXO DO BRASIL COMERCIAL S.A. HYPER MARCAS");
    expect(sequenceMigration).toContain("public.reconciliar_dia_visita_contratual_agendada");
    expect(sequenceMigration).not.toContain("LIKE '%hyper%'");
  });

  it("usa a mesma regra de técnicos e auxiliares do Agendamento Equipe", () => {
    expect(isFieldTechnician({ cargo: "Técnico de campo" })).toBe(true);
    expect(isFieldTechnician({ funcao: "Auxiliar técnico" })).toBe(true);
    expect(isFieldTechnician({ cargo: "Financeiro" })).toBe(false);
  });

  it("não permite que a carga da visita ultrapasse o dia", () => {
    expect(() => addMinutesToClock("23:00", 120)).toThrow("CARGA_ULTRAPASSA_DIA");
  });

  it("não envia visitas ao Auvo e troca o futuro em uma transação", () => {
    const page = readFileSync(resolve(root, "src/pages/agendamento/VisitasContratuaisPage.tsx"), "utf8");
    const planning = readFileSync(resolve(root, "src/lib/contractVisitPlanning.ts"), "utf8");
    const migration = readFileSync(
      resolve(root, "supabase/migrations/20260810190000_contractual_visits_annual_plan.sql"),
      "utf8",
    );
    expect(page).not.toContain("Duração (min)");
    expect(page).not.toContain("Janeiro a dezembro");
    expect(page).toContain("visualizados somente no Agendamento Equipe");
    expect(planning).not.toContain("functions.invoke");
    expect(planning).toContain("reconciliar_previsoes_visitas_contratuais");
    expect(migration).toContain("DELETE FROM public.agenda_agendamentos");
    expect(migration).toContain("INSERT INTO public.agenda_agendamentos");
  });
});
