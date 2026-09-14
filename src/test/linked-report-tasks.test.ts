import { describe, expect, it, vi } from "vitest";
import {
  confirmedAuvoTask,
  mapLinkedAuvoReportTask,
  syncLinkedReportTasks,
} from "../../supabase/functions/central-sync/linked-report-tasks";

type Row = Record<string, any>;

// Stateful persistence fake: a write to the wrong identity changes the wrong
// record, and omitted fields keep their previous values just as UPDATE does.
function database(initial: Row[] = [], options: {
  readErrorFor?: string; writeErrorFor?: string; concurrentInsert?: Row;
} = {}) {
  const rows = initial.map((row) => structuredClone(row));
  const writes: Array<{ kind: string; value: Row }> = [];
  const db = {
    from: vi.fn((table: string) => {
      if (table !== "tarefas_central") throw new Error(`Unexpected table ${table}`);
      let operation = "read";
      let value: Row = {};
      let ignoreDuplicates = false;
      const filters: Array<[string, unknown]> = [];
      const query: any = {
        select: () => query,
        eq: (key: string, expected: unknown) => { filters.push([key, expected]); return query; },
        update: (patch: Row) => { operation = "update"; value = patch; return query; },
        upsert: (row: Row, config?: { ignoreDuplicates?: boolean }) => {
          operation = "upsert"; value = row; ignoreDuplicates = config?.ignoreDuplicates === true; return query;
        },
        then: (resolve: any, reject: any) => {
          const taskId = String(filters.find(([key]) => key === "auvo_task_id")?.[1] ?? value.auvo_task_id ?? "");
          const selected = rows.filter((row) => filters.every(([key, expected]) => row[key] === expected));
          let error: { message: string } | null = null;
          if (operation === "read" && options.readErrorFor === taskId) error = { message: "read unavailable" };
          if (operation !== "read" && options.writeErrorFor === taskId) error = { message: "write unavailable" };
          if (!error && operation === "update") {
            writes.push({ kind: operation, value: structuredClone(value) });
            selected.forEach((row) => Object.assign(row, value));
          }
          if (!error && operation === "upsert") {
            if (options.concurrentInsert) {
              rows.push(structuredClone(options.concurrentInsert));
              options.concurrentInsert = undefined;
            }
            writes.push({ kind: operation, value: structuredClone(value) });
            const existing = rows.find((row) => row.mirror_key === value.mirror_key);
            if (existing && !ignoreDuplicates) Object.assign(existing, value);
            else if (existing) { /* The other synchronization keeps its GC fields. */ }
            else rows.push(structuredClone(value));
          }
          return Promise.resolve({ data: selected.map((row) => ({ ...row })), error }).then(resolve, reject);
        },
      };
      return query;
    }),
  };
  return { db, rows, writes };
}

const openTask = (taskID: string, extra: Row = {}) => ({
  taskID, taskStatus: 1, checkIn: false, checkOut: false, ...extra,
});
const mirror = (taskId: string, osId: string, extra: Row = {}) => ({
  auvo_task_id: taskId, mirror_key: `${taskId}::os:${osId}::orc:`,
  gc_os_id: osId, gc_os_codigo: `OS-${osId}`, gc_orcamento_id: `OR-${osId}`,
  status_auvo: "Pausada", duracao_decimal: 4, ...extra,
});

describe("identidade do detalhe Auvo usado no Controle OS", () => {
  it.each([
    { result: openTask("79755965") },
    { data: { result: openTask("79755965") } },
    openTask("79755965"),
  ])("aceita a identidade confirmada nos envelopes conhecidos", (payload) => {
    expect(confirmedAuvoTask(payload, "79755965")).toMatchObject({ taskID: "79755965", taskStatus: 1 });
  });

  it.each([{}, { result: {} }, { result: [] }, { result: openTask("79755966") },
    { result: { taskID: "79755965" } }, { result: { taskID: "79755965", taskStatus: {} } }])("rejeita HTTP200 sem identidade ou situação confirmada", (payload) => {
    expect(() => confirmedAuvoTask(payload, "79755965")).toThrow(/confirmou.*identidade.*situação/);
  });
});

describe("campos reais da tarefa, separados de previsão e vínculo GC", () => {
  it("limpa data e técnico quando o Auvo confirma tarefa sem agendamento", () => {
    const row = mapLinkedAuvoReportTask(openTask("78949564", {
      taskDate: null, taskEndDate: null, idUserTo: 0,
    }));
    expect(row).toMatchObject({ data_tarefa: null, hora_inicio: null, hora_fim: null,
      tecnico_id: "", tecnico: "", duracao_decimal: 0 });
  });

  it("não contabiliza as duas horas planejadas da tarefa aberta 79755965", () => {
    const row = mapLinkedAuvoReportTask(openTask("79755965", {
      taskDate: "2026-09-15T08:00:00", estimatedDuration: "02:00:00",
      duration: "", durationDecimal: "", checkInDate: "", checkOutDate: "",
    }));
    expect(row).toMatchObject({ status_auvo: "Aberta", duracao_decimal: 0,
      data_tarefa: "2026-09-15", hora_inicio: "08:00", check_in: false, check_out: false,
      check_in_iso: null, check_out_iso: null, data_conclusao: null });
    expect(row).not.toHaveProperty("hora_fim");
  });

  it("mantém a tarefa 79424514 pausada apesar do check-in e da janela planejada", () => {
    const row = mapLinkedAuvoReportTask({
      taskID: "79424514", taskStatus: 6, finished: false, checkIn: true, checkOut: false,
      checkInDate: "2026-09-08T09:57:19", checkOutDate: "", duration: "11:58:26",
      estimatedDuration: "08:00:00", taskEndDate: "2026-09-08T16:00:00", timeControl: [],
    });
    expect(row).toMatchObject({ status_auvo: "Pausada", check_in: true, check_out: false,
      data_conclusao: null, check_out_iso: null });
  });

  it("prioriza duração oficial e preserva seus segundos em vez dos quatro dias entre eventos", () => {
    const row = mapLinkedAuvoReportTask({
      taskID: "76566385", taskStatus: 5, finished: true, checkIn: true, checkOut: true,
      checkInDate: "2026-07-05T16:10:51", checkOutDate: "2026-07-09T21:25:37",
      duration: "07:42:54", durationDecimal: "7.715", estimatedDuration: "04:00:00", timeControl: [],
    });
    expect(row).toMatchObject({ status_auvo: "Finalizada", duracao_decimal: 7.715,
      data_conclusao: "2026-07-09", hora_inicio: "16:10", hora_fim: "21:25" });
  });

  it("desconta pausa do intervalo real quando a duração oficial está ausente", () => {
    const row = mapLinkedAuvoReportTask({ taskID: "12345", taskStatus: 5,
      checkInDate: "2026-09-14T08:00:00-03:00", checkOutDate: "2026-09-14T12:00:00-03:00",
      estimatedDuration: "08:00:00", timeControl: [{
        pauseStart: "2026-09-14T10:00:00-03:00", pauseEnd: "2026-09-14T10:30:00-03:00",
      }],
    });
    expect(row.duracao_decimal).toBe(3.5);
    expect(row.check_in_iso).toBe("2026-09-14T11:00:00.000Z");
  });

  it("aceita TimeSpan com dias sem perder a duração real acima de 24h", () => {
    const row = mapLinkedAuvoReportTask({ taskID: "12345", taskStatus: 5,
      duration: "1.02:30:36", estimatedDuration: "08:00:00" });
    expect(row.duracao_decimal).toBe(26.51);
  });

  it("não usa durationDecimal sem check-in nem inventa data a partir da OS", () => {
    const row = mapLinkedAuvoReportTask(openTask("79721161", {
      durationDecimal: 8, estimatedDuration: "08:00:00", gc_os_data: "2026-09-14",
    }));
    expect(row.duracao_decimal).toBe(0);
    expect(row).not.toHaveProperty("data_tarefa");
    expect(row).not.toHaveProperty("hora_inicio");
    expect(Object.keys(row).some((key) => key.startsWith("gc_"))).toBe(false);
    expect(row).not.toHaveProperty("mirror_key");
  });

  it("trata as datas sentinela do Auvo como ausência de eventos", () => {
    const row = mapLinkedAuvoReportTask(openTask("79721161", {
      taskDate: "0001-01-01T00:00:00", checkInDate: "0001-01-01T00:00:00",
      checkOutDate: "0001-01-01T00:00:00", durationDecimal: 8,
    }));
    expect(row).toMatchObject({ data_tarefa: null, hora_inicio: null, check_in: false,
      check_out: false, check_in_iso: null, check_out_iso: null, duracao_decimal: 0 });
  });

  it("preserva perguntas de execução mesmo fora do questionário preferencial", () => {
    const row = mapLinkedAuvoReportTask(openTask("79721161", {
      questionnaires: [{ questionnaireId: 214757, questionnaireDescription: "EXECUÇÃO DE SERVIÇOS",
        answers: [{ questionId: 1, replyId: 10, questionDescription: "SERVIÇOS REALIZADOS", reply: "Troca de rolamentos" }],
      }], report: "Serviço conferido", pendency: "Sem pendência",
    }));
    expect(row).toMatchObject({ questionario_id: "214757", questionario_preenchido: true,
      relato_usuario: "Serviço conferido", pendencia: "Sem pendência" });
    expect(row.questionario_respostas).toEqual([expect.objectContaining({
      question: "SERVIÇOS REALIZADOS", reply: "Troca de rolamentos", questionnaireId: "214757",
    })]);
    expect(mapLinkedAuvoReportTask(openTask("79721161"))).not.toHaveProperty("questionario_respostas");
  });
});

describe("sincronização de tarefas explícitas do GC por ID, sem filtro de datas", () => {
  it("busca uma vez cada ID antigo, futuro ou sem data e insere as tarefas ausentes", async () => {
    const { db, rows } = database();
    const tasks = [openTask("10001", { taskDate: "2020-01-01T08:00:00" }),
      openTask("10002", { taskDate: "2030-01-01T08:00:00" }), openTask("10003")];
    const getTask = vi.fn(async (id: string) => Response.json({ result: tasks.find((task) => task.taskID === id) }));
    const result = await syncLinkedReportTasks(db, ["10001", "10002", "10003", "10001"], { getTask });
    expect(getTask.mock.calls).toEqual([["10001"], ["10002"], ["10003"]]);
    expect(result).toMatchObject({ success: true, incomplete: false, auvo_tarefas: 3, upserted: 3, warnings: [] });
    expect(rows.map((row) => row.data_tarefa)).toEqual(["2020-01-01", "2030-01-01", null]);
  });

  it("insere a execução 73344 sem copiar o espelho diagnóstico 73343", async () => {
    const diagnostic = mirror("77509677", "398336240", {
      gc_os_tarefa_os: "77509677", gc_os_tarefa_exec: "79721161", cliente: "Cliente diagnóstico",
    });
    const { db, rows } = database([diagnostic]);
    await syncLinkedReportTasks(db, ["79721161"], {
      getTask: async () => Response.json({ result: openTask("79721161", { customerDescription: "Cliente execução" }) }),
    });
    expect(rows[0]).toEqual(diagnostic);
    expect(rows[1]).toMatchObject({ auvo_task_id: "79721161", mirror_key: "79721161::os:::orc:",
      cliente: "Cliente execução", os_realizada: false, orcamento_realizado: false, duracao_decimal: 0 });
    expect(rows[1]).not.toHaveProperty("gc_os_id");
    expect(rows[1]).not.toHaveProperty("gc_orcamento_id");
  });

  it("atualiza todos os espelhos e mantém a identidade GC de cada documento", async () => {
    const initial = [mirror("79755965", "100"), mirror("79755965", "200"), mirror("11111", "300")];
    const { db, rows, writes } = database(initial);
    const result = await syncLinkedReportTasks(db, ["79755965"], {
      getTask: async () => Response.json({ result: openTask("79755965", { estimatedDuration: "02:00:00" }) }),
    });
    expect(result.upserted).toBe(1);
    expect(rows).toHaveLength(3);
    for (let i = 0; i < 2; i++) {
      expect(rows[i]).toMatchObject({ ...initial[i], status_auvo: "Aberta", duracao_decimal: 0 });
    }
    expect(rows[2]).toEqual(initial[2]);
    expect(writes).toHaveLength(1);
    expect(writes[0].kind).toBe("update");
    expect(writes[0].value).not.toHaveProperty("mirror_key");
    expect(Object.keys(writes[0].value).some((key) => key.startsWith("gc_"))).toBe(false);
  });

  it("preserva vínculo GC inserido por outra sincronização entre a consulta e o upsert", async () => {
    const concurrent = {
      auvo_task_id: "79721161", mirror_key: "79721161::os:::orc:", gc_os_id: "398336240",
      gc_os_codigo: "10234", gc_orcamento_id: "orc-6563", gc_orcamento_codigo: "6563",
      gc_os_tarefa_os: "77509677", gc_os_tarefa_exec: "79721161",
      os_realizada: true, orcamento_realizado: true, status_auvo: "Pendente vínculo Auvo",
    };
    const { db, rows } = database([], { concurrentInsert: concurrent });
    await syncLinkedReportTasks(db, ["79721161"], {
      getTask: async () => Response.json({ result: openTask("79721161", { customerDescription: "Cliente confirmado" }) }),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...concurrent, status_auvo: "Aberta",
      cliente: "Cliente confirmado", duracao_decimal: 0 });
  });

  it.each([{}, { result: {} }, { result: openTask("99999") }])("HTTP200 inválido preserva dados e continua a próxima tarefa", async (payload) => {
    const original = mirror("79755965", "100", { questionario_respostas: [{ reply: "Preservado" }] });
    const { db, rows } = database([original]);
    const getTask = vi.fn(async (id: string) => Response.json(id === "79755965" ? payload : { result: openTask(id) }));
    const result = await syncLinkedReportTasks(db, ["79755965", "10002"], { getTask });
    expect(rows[0]).toEqual(original);
    expect(rows).toHaveLength(2);
    expect(result).toMatchObject({ incomplete: true, upserted: 1,
      warnings: [{ kind: "auvo_task", task_id: "79755965", status: 200 }] });
  });

  it("404 vira pendência sem excluir espelho e permite buscar a próxima tarefa", async () => {
    const original = mirror("79755965", "100");
    const { db, rows } = database([original]);
    const getTask = vi.fn(async (id: string) => id === "79755965"
      ? new Response(null, { status: 404 }) : Response.json({ result: openTask(id) }));
    const result = await syncLinkedReportTasks(db, ["79755965", "10002"], { getTask });
    expect(rows[0]).toEqual(original);
    expect(getTask).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ incomplete: true, upserted: 1,
      warnings: [{ task_id: "79755965", status: 404, message: expect.stringContaining("preservado") }] });
  });

  it.each([401, 403])("HTTP%i aborta o lote sem mexer nos registros nem avançar IDs", async (status) => {
    const original = mirror("79755965", "100");
    const { db, rows, writes } = database([original]);
    const getTask = vi.fn(async () => new Response(null, { status }));
    await expect(syncLinkedReportTasks(db, ["79755965", "10002"], { getTask })).rejects.toThrow(`HTTP ${status}`);
    expect(getTask).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([original]);
    expect(writes).toHaveLength(0);
  });

  it("falha ao ler os espelhos impede uma inserção duplicada", async () => {
    const original = mirror("79755965", "100");
    const { db, rows, writes } = database([original], { readErrorFor: "79755965" });
    const result = await syncLinkedReportTasks(db, ["79755965"], {
      getTask: async () => Response.json({ result: openTask("79755965") }),
    });
    expect(result).toMatchObject({ incomplete: true, upserted: 0 });
    expect(rows).toEqual([original]);
    expect(writes).toHaveLength(0);
  });

  it("só chama afterSave para tarefas efetivamente persistidas", async () => {
    const { db } = database([], { writeErrorFor: "10001" });
    const afterSave = vi.fn(async () => undefined);
    const result = await syncLinkedReportTasks(db, ["10001", "10002"], {
      getTask: async (id) => Response.json({ result: openTask(id) }), afterSave,
      enrich: async () => ({ equipamento_nome: "Forno Rational" }),
    });
    expect(result).toMatchObject({ incomplete: true, upserted: 1 });
    expect(afterSave).toHaveBeenCalledTimes(1);
    expect(afterSave).toHaveBeenCalledWith(expect.objectContaining({ taskID: "10002" }));
  });
});
