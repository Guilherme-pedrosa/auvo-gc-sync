import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), save: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn(), refetch: vi.fn(), empty: [],
  items: [] as AgendaAgendamento[],
  technicians: [
    { id: "source", nome: "Ayrton", cargo: "Técnico", ativo: true, auvo_user_id: "207034" },
    { id: "destination", nome: "Denilson", cargo: "Técnico", ativo: true, auvo_user_id: "184766" as string | null },
  ],
}));
vi.mock("@/hooks/rh/useRh", () => ({ useColaboradores: () => ({ data: mocks.technicians, refetch: mocks.refetch }), useRhClientes: () => ({ data: mocks.empty }) }));
vi.mock("@/hooks/operacional/useAgendamentoEquipe", () => ({
  useAgendaVeiculos: () => ({ data: mocks.empty }),
  useAgendaSemana: () => ({ data: { agendamentos: mocks.items, veiculoDias: mocks.empty }, refetch: mocks.refetch }),
  useSaveAgendamento: () => ({ mutateAsync: mocks.save }),
  useSalvarCelulaTecnico: () => ({ mutate: vi.fn() }), useSalvarCelulaVeiculo: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/operacional/useAgendaTags", () => ({ useAgendaTags: () => ({ data: mocks.empty }), useAgendaTagLinks: () => ({ data: mocks.empty }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke }, rpc: vi.fn(), from: () => {
  const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: mocks.items[0] ? { ...mocks.items[0] } : null, error: null }) };
  return query;
} } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mocks.empty }), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { loading: vi.fn(), error: mocks.error, success: mocks.success, warning: mocks.warning, message: vi.fn() } }));
vi.mock("@/components/operacional/AgendamentoEquipeDialog", () => ({ default: () => null }));
vi.mock("@/components/operacional/TarefaAuvoDetalheDialog", () => ({ default: () => null }));
vi.mock("@/components/operacional/CriarTarefaGeralDialog", () => ({ default: () => null }));
vi.mock("@/components/operacional/AgendaRelatorioDialog", () => ({ default: () => null }));
vi.mock("@/components/LastSyncBadge", () => ({ default: () => null }));
import AgendamentoEquipePage from "@/pages/operacional/AgendamentoEquipePage";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 15, 10));
  mocks.technicians[1].auvo_user_id = "184766";
  mocks.items = [{ id: "execution-card", auvo_task_id: "79667772", origem: "AUVO", gc_os_codigo: "10222",
    data: "2026-09-15", hora_inicio: "08:30:00", hora_fim: "10:30:00", colaborador_id: "source", colaborador_nome: "Ayrton",
    veiculo_id: null, cliente: "Cliente execução", descricao: "EXECUÇÃO", status: "AGENDADO", previsao_continuidade: false }];
  mocks.save.mockResolvedValue({ id: "execution-card" });
  mocks.refetch.mockResolvedValue({ data: null });
  mocks.invoke.mockImplementation(async (_name, { body }) => body.report_step === "os_tasks"
    ? { data: { success: true, report_step: "os_tasks", auvo_tarefas: 1, upserted: 1, warnings: [], incomplete: false }, error: null }
    : body.action === "edit-schedule"
    ? { data: { success: true, status: 200 }, error: null }
    : { data: { status: 200, data: { result: { taskID: 79667772, idUserTo: 184766, taskDate: "2026-09-17T08:30:00" } } }, error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function dropOnDestination(dayIndex = 2, startSyncFirst = false) {
  const view = render(<AgendamentoEquipePage />);
  if (startSyncFirst) fireEvent.click(screen.getByRole("button", { name: /^Sincronizar Auvo/ }));
  const card = view.container.querySelector('[data-agenda-item="execution-card"] button[draggable="true"]')!;
  expect(card).not.toBeNull();
  const targetRow = screen.getByText("Denilson").closest("tr")!;
  const target = targetRow.querySelectorAll("[data-agenda-day-cell]")[dayIndex];
  fireEvent.dragStart(card);
  fireEvent.drop(target);
  return { ...view, dropAgain(dayIndex: number) {
    fireEvent.dragStart(card);
    fireEvent.drop(targetRow.querySelectorAll("[data-agenda-day-cell]")[dayIndex]);
  } };
}

describe("arraste real no Agendamento Equipe", () => {
  it("muda data e responsável da execução e só grava o cartão depois da confirmação Auvo", async () => {
    let confirm: (value: any) => void;
    mocks.invoke.mockImplementationOnce(async () => ({ data: { success: true, status: 200 }, error: null }))
      .mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
    dropOnDestination();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke.mock.calls[0][1].body).toEqual({ action: "edit-schedule", taskId: 79667772, taskDate: "2026-09-17T08:30:00", idUserTo: 184766 });
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => { confirm!({ data: { status: 200, data: { result: { taskID: 79667772, idUserTo: 184766, taskDate: "2026-09-17T08:30:00" } } }, error: null }); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: "execution-card", colaborador_id: "destination", colaborador_nome: "Denilson", data: "2026-09-17" })));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(mocks.invoke.mock.calls.filter(([name]) => name === "auvo-task-update").every(([, { body }]) => body.taskId === 79667772)).toBe(true);
    expect(mocks.invoke).toHaveBeenLastCalledWith("central-sync", { body: { report_step: "os_tasks", task_ids: ["79667772"], wait: true } });
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[2]);
    expect(Object.keys(mocks.save.mock.calls[0][0]).sort()).toEqual(["colaborador_id", "colaborador_nome", "data", "id"]);
  });

  it("não move só no banco quando o técnico de destino não possui ID Auvo", async () => {
    mocks.technicians[1].auvo_user_id = null;
    dropOnDestination();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("não edita o Auvo nem recria um cartão que desapareceu antes de executar o arraste", async () => {
    dropOnDestination();
    mocks.items = [];
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("não está mais disponível"), expect.anything()));
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("preserva o cartão quando o Auvo mantém o responsável anterior", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { success: true, status: 200 }, error: null })
      .mockResolvedValueOnce({ data: { status: 200, data: { taskID: 79667772, idUserTo: 207034, taskDate: "2026-09-17T08:30:00" } }, error: null });
    dropOnDestination();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("tarefas reais com origem legada também atualizam Auvo", async () => {
    mocks.items[0].origem = "MANUAL";
    dropOnDestination();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.invoke.mock.calls[0][1].body.idUserTo).toBe(184766);
  });

  it("trocar somente a linha mantém a data e envia obrigatoriamente o responsável destino", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { success: true, status: 200 }, error: null })
      .mockResolvedValueOnce({ data: { status: 200, data: { taskID: 79667772, idUserTo: 184766, taskDate: "2026-09-15T08:30:00" } }, error: null });
    dropOnDestination(0);
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({ taskDate: "2026-09-15T08:30:00", idUserTo: 184766 });
  });

  it("informa alteração já feita no Auvo se a gravação local falhar", async () => {
    mocks.save.mockRejectedValueOnce(new Error("Falha local"));
    dropOnDestination();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("já foram alterados no Auvo"), expect.anything()));
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("avisa que relatórios estão pendentes quando a reconciliação é parcial após mover", async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { success: true, status: 200 }, error: null })
      .mockResolvedValueOnce({ data: { status: 200, data: { taskID: 79667772, idUserTo: 184766, taskDate: "2026-09-17T08:30:00" } }, error: null })
      .mockResolvedValueOnce({ data: { success: true, report_step: "os_tasks", auvo_tarefas: 0, upserted: 0, incomplete: true, warnings: [{}] }, error: null });
    dropOnDestination();
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining("atualizados no Auvo e na agenda"), expect.anything()));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("não anuncia sucesso quando React Query devolve erro ao recarregar a tela", async () => {
    mocks.refetch.mockResolvedValue({ error: new Error("Sem conexão") });
    dropOnDestination();
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("tela não pôde ser recarregada"), expect.anything()));
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each([false, true])("aguarda a sincronização em voo e usa a identidade atual do cartão (previsão promovida: %s)", async wasForecast => {
    const currentTask = { ...mocks.items[0] };
    if (wasForecast) mocks.items[0] = { ...currentTask, origem: "MANUAL", auvo_task_id: null, previsao_continuidade: true, previsao_tipo: "ORCAMENTO_EXECUCAO", status: "PREVISAO" };
    let finishSnapshot: (value: any) => void;
    let snapshotPending = true;
    const normalInvoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((name, options) => {
      if (name === "auvo-agenda") {
        if (snapshotPending) { snapshotPending = false; return new Promise(resolve => { finishSnapshot = resolve; }); }
        return Promise.resolve({ data: { data: [], sync_complete: false }, error: null });
      }
      return normalInvoke(name, options);
    });
    dropOnDestination(2, true);
    await waitFor(() => expect(mocks.invoke.mock.calls.some(([name]) => name === "auvo-agenda")).toBe(true));
    expect(mocks.invoke.mock.calls.some(([, { body }]) => body.action === "edit-schedule")).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
    // The queued sync has promoted/enriched the same UUID before this drag runs.
    mocks.items[0] = currentTask;
    await act(async () => { finishSnapshot!({ data: { data: [], sync_complete: false }, error: null }); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ colaborador_id: "destination" })));
  });

  it("serializa dois arrastes rápidos do mesmo cartão na ordem escolhida", async () => {
    let confirmFirst: (value: any) => void;
    let getCount = 0;
    let requestedDate = "";
    const normalInvoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((name, options) => {
      if (options.body.action === "edit-schedule") requestedDate = String(options.body.taskDate);
      if (options.body.action === "get") {
        if (++getCount === 1) return new Promise(resolve => { confirmFirst = resolve; });
        return Promise.resolve({ data: { status: 200, data: { taskID: 79667772, idUserTo: 184766, taskDate: requestedDate } }, error: null });
      }
      return normalInvoke(name, options);
    });
    const view = dropOnDestination();
    await waitFor(() => expect(getCount).toBe(1));
    view.dropAgain(3);
    expect(mocks.invoke.mock.calls.filter(([, { body }]) => body.action === "edit-schedule")).toHaveLength(1);
    await act(async () => { confirmFirst!({ data: { status: 200, data: { taskID: 79667772, idUserTo: 184766, taskDate: "2026-09-17T08:30:00" } }, error: null }); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls.map(([saved]) => saved.data)).toEqual(["2026-09-17", "2026-09-18"]);
    const requests = mocks.invoke.mock.calls.map(([, { body }]) => body.action || body.report_step);
    expect(requests).toEqual(["edit-schedule", "get", "os_tasks", "edit-schedule", "get", "os_tasks"]);
  });

  it.each(["CONTINUACAO", "SALDO_BAIXA_PARCIAL"])("previsão %s com referência histórica não altera a tarefa real", async previsao_tipo => {
    mocks.items[0] = { ...mocks.items[0], origem: "MANUAL", previsao_continuidade: true, previsao_tipo, status: "PREVISAO", gc_os_codigo: null };
    dropOnDestination();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
