import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import OSAbertasTab from "../components/relatorios/OSAbertasTab";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("../components/relatorios/ObservacoesOsDialog", () => ({ ObservacoesOsDialog: () => null }));

const order = {
  gc_os_id: "77", gc_os_codigo: "10235", gc_os_cliente: "Cliente teste", cliente: "Cliente teste",
  gc_os_situacao_id: "7063705", gc_os_situacao: "PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO",
  gc_os_valor_total: 100, gc_os_data: "2026-09-01", gc_os_tarefa_os: "11", gc_os_tarefa_exec: "21",
  auvo_task_id: "10", tecnico: "Diagnóstico antigo", status_auvo: "Finalizada", equipamento_nome: "Forno",
};
const diagnosis = { auvo_task_id: "11", tecnico: "Diagnóstico atual", status_auvo: "Finalizada", atualizado_em: "2026-09-14" };
const props = { isLoading: false, allClientes: ["Cliente teste"], syncing: true };

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
  });
  mocks.invoke.mockReset();
  mocks.invoke.mockImplementation(async (_name, { body }) => ({
    data: { data: { taskID: body.taskId, taskStatus: 1, userToName: "Executor anterior", taskDate: "2026-09-02T08:00:00" } }, error: null,
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("Controle OS — atualização dos vínculos e do cache visual", () => {
  it("OS 10222 mantém execução 79667772 sem agenda mesmo com diagnóstico 70949049 finalizado", async () => {
    const current = { ...order, gc_os_id: "397842014", gc_os_codigo: "10222", auvo_task_id: "70949049",
      gc_os_tarefa_os: "70949049", gc_os_tarefa_exec: "79667772", data_tarefa: "2026-06-01" };
    const previousDiagnosis = { ...diagnosis, auvo_task_id: "70949049", data_tarefa: "2026-06-01" };
    mocks.invoke.mockResolvedValue({ data: { data: { taskID: 79667772, taskStatus: 1,
      idUserTo: 0, userToName: "Nome antigo não atribuído", taskDate: "0001-01-01T00:00:00" } }, error: null });
    render(<OSAbertasTab {...props} data={[current]} allTasks={[current, previousDiagnosis]} />);
    fireEvent.click(screen.getByText("Cliente teste"));
    const row = screen.getByText("10222").closest("tr")!;
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("auvo-task-update", { body: { action: "get", taskId: 79667772 } }));
    expect(within(row).getByText("Diagnóstico atual")).toBeInTheDocument();
    expect(within(row).getAllByRole("cell")[4]).toHaveTextContent("—");
    expect(within(row).getAllByRole("cell")[7]).toHaveTextContent("—");
    expect(screen.queryByText("Nome antigo não atribuído")).not.toBeInTheDocument();
    expect(within(row).queryByText("Finalizada")).not.toBeInTheDocument();
  });

  it("troca o resultado live anterior pelo novo espelho e acompanha mudanças de 73343/73344", async () => {
    const { rerender } = render(<OSAbertasTab {...props} data={[order]} allTasks={[order, diagnosis]} />);
    fireEvent.click(screen.getByText("Cliente teste"));
    expect(screen.getByText("Diagnóstico atual")).toBeInTheDocument();
    expect(screen.queryByText("Diagnóstico antigo")).not.toBeInTheDocument();
    await screen.findByText("Executor anterior");

    const synced = { auvo_task_id: "21", tecnico: "Executor sincronizado", status_auvo: "Finalizada",
      data_tarefa: "2026-09-03", atualizado_em: "2026-09-14T12:00:00" };
    rerender(<OSAbertasTab {...props} data={[{ ...order }]} allTasks={[order, diagnosis, synced]} />);
    await waitFor(() => expect(screen.getByText("Executor sincronizado")).toBeInTheDocument());
    expect(screen.queryByText("Executor anterior")).not.toBeInTheDocument();

    const changedOrder = { ...order, gc_os_tarefa_os: "12", gc_os_tarefa_exec: "22" };
    const newDiagnosis = { ...diagnosis, auvo_task_id: "12", tecnico: "Diagnóstico novo" };
    const newExecution = { ...synced, auvo_task_id: "22", tecnico: "Execução nova" };
    rerender(<OSAbertasTab {...props} data={[changedOrder]} allTasks={[changedOrder, diagnosis, synced, newDiagnosis, newExecution]} />);
    await waitFor(() => expect(screen.getByText("Execução nova")).toBeInTheDocument());
    expect(screen.getByText("Diagnóstico novo")).toBeInTheDocument();
    expect(screen.queryByText("Executor sincronizado")).not.toBeInTheDocument();
    expect(screen.queryByText("Diagnóstico atual")).not.toBeInTheDocument();
  });

  it("um espelho confirmado sem agendamento não assume a data da OS nem consulta Auvo novamente", async () => {
    const unscheduled = { auvo_task_id: "21", tecnico: "", status_auvo: "Aberta", data_tarefa: null };
    render(<OSAbertasTab {...props} data={[order]} allTasks={[order, diagnosis, unscheduled]} />);
    fireEvent.click(screen.getByText("Cliente teste"));
    const row = screen.getByText("10235").closest("tr")!;
    expect(within(row).getAllByRole("cell")[7]).toHaveTextContent("—");
    await waitFor(() => expect(mocks.invoke).not.toHaveBeenCalled());
  });
});
