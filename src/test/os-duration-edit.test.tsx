import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OSAbertasTab from "@/components/relatorios/OSAbertasTab";
import { toast } from "sonner";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), from: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke }, from: mocks.from } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? children : null,
  DialogContent: ({ children }: any) => <section role="dialog">{children}</section>,
  DialogHeader: ({ children }: any) => children, DialogFooter: ({ children }: any) => children,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/relatorios/ObservacoesOsDialog", () => ({ ObservacoesOsDialog: () => null }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => <select aria-label="Selecionar duração" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => children,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

const order = { gc_os_id: "77", gc_os_codigo: "10222", gc_os_cliente: "Cliente teste", cliente: "Cliente teste",
  gc_os_situacao_id: "7063705", gc_os_situacao: "PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO", gc_os_valor_total: 100,
  gc_os_data: "2026-09-01", gc_os_tarefa_os: "70949049", gc_os_tarefa_exec: "79667772",
  auvo_task_id: "70949049", mirror_key: "os:77:diagnostico", tecnico: "Diagnóstico", status_auvo: "Finalizada", equipamento_nome: "Forno" };
const execution = { auvo_task_id: "79667772", tecnico: "Executor", status_auvo: "Aberta", data_tarefa: "2026-09-17" };
let agendaUpdates: any[];

beforeEach(() => {
  vi.clearAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  agendaUpdates = [];
  mocks.from.mockImplementation(() => {
    const query: any = { select: () => query, update: (patch: any) => { agendaUpdates.push(patch); return query; },
      eq: () => query, or: async () => ({ data: [{ id: "real", hora_inicio: "08:00:00", previsao_continuidade: false }], error: null }) };
    return query;
  });
  mocks.invoke.mockImplementation(async (name, { body }) => {
    if (name === "gc-proxy") return { data: { data: { atributos: [
      { atributo_id: "73343", conteudo: "70949049" }, { atributo_id: "73344", conteudo: "79667772" },
    ] } }, error: null };
    if (body.action === "get") return { data: { data: { taskID: 79667772, taskDate: "2026-09-17T08:00:00", estimatedDuration: "01:00:00", idUserTo: 123 } }, error: null };
    if (body.action === "edit-schedule") return { data: { success: true, duration: { verified: true,
      requestedMinutes: body.durationMinutes, actualMinutes: body.durationMinutes } }, error: null };
    if (name === "central-sync") return { data: { success: true, report_step: "os_tasks", auvo_tarefas: 1, upserted: 1, warnings: [], incomplete: false }, error: null };
    throw new Error(`Unexpected action ${name}/${body.action}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

async function editDuration() {
  const onRefresh = vi.fn();
  render(<OSAbertasTab data={[order]} allTasks={[order, execution]} allClientes={["Cliente teste"]} isLoading={false} onRefresh={onRefresh} />);
  fireEvent.click(screen.getByText("Cliente teste"));
  fireEvent.click(screen.getByTitle("Editar agendamento"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Salvar" })).not.toBeDisabled());
  const duration = screen.getAllByRole("combobox").find(select => select.querySelector('option[value="02:30"]'))!;
  fireEvent.change(duration, { target: { value: "02:30" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  return onRefresh;
}

describe("Controle OS — edição da duração de execução", () => {
  it("confirma execução, salva planejado e busca horas reais sem reaproveitar espelho de diagnóstico", async () => {
    const onRefresh = await editDuration();
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(mocks.invoke).toHaveBeenCalledWith("auvo-task-update", { body: expect.objectContaining({ action: "edit-schedule", taskId: 79667772, durationMinutes: 150 }) });
    expect(mocks.invoke).toHaveBeenCalledWith("central-sync", { body: { report_step: "os_tasks", task_ids: ["79667772"], wait: true } });
    expect(mocks.invoke.mock.calls.some(([, args]) => args.body.action === "persist-central")).toBe(false);
    expect(agendaUpdates).toEqual([{ duracao_planejada_minutos: 150, hora_fim: "10:30:00" }]);
    const edit = mocks.invoke.mock.calls.find(([, args]) => args.body.action === "edit-schedule")![1].body;
    expect(edit).not.toHaveProperty("taskDate");
    expect(edit).not.toHaveProperty("idUserTo");
  });
  it("não grava planejado nem horas reais quando Auvo responde zero", async () => {
    const invoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((name, args) => args.body.action === "edit-schedule"
      ? Promise.resolve({ data: { success: true, duration: { verified: false, actualMinutes: 0, requestedMinutes: 150 } }, error: null }) : invoke(name, args));
    await editDuration();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("02:30")));
    expect(agendaUpdates).toHaveLength(0);
    expect(mocks.invoke.mock.calls.some(([name]) => name === "central-sync")).toBe(false);
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
  });
  it("informa falha parcial após duração confirmada sem sugerir rollback no Auvo", async () => {
    const invoke = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((name, args) => name === "central-sync"
      ? Promise.resolve({ data: { success: true, upserted: 0, incomplete: true }, error: null }) : invoke(name, args));
    await editDuration();
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("atualizada no Auvo"), expect.anything()));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
