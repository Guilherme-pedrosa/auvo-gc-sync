import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transferableAbortController } from "node:util";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), rows: [] as any[], referenced: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: mocks.invoke },
  from: (table: string) => {
    let byTask = false;
    const query: any = { select: () => query, order: () => query, range: () => query, not: () => query,
      eq: () => query, in: (column: string) => { byTask = column === "auvo_task_id"; return query; }, abortSignal: () => query,
      then: (resolve: any) => Promise.resolve({ data: table === "tarefas_central" ? byTask ? mocks.referenced : mocks.rows : [], error: null }).then(resolve) };
    return query;
  },
} }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, warning: mocks.warning } }));
vi.mock("@/components/LastSyncBadge", () => ({ default: () => null }));
vi.mock("@/components/relatorios/OSAbertasTab", () => ({ default: ({ onSync, syncing, allTasks, execTaskStatusMap }: any) => <div>
  OS preservadas na tela<button disabled={syncing} onClick={() => onSync(["7063705"])}>Sincronizar OS da aba</button>
  {allTasks?.filter((task: any) => task.auvo_task_id === "79721161").map((task: any, index: number) =>
    <span key={index}>Execução vinculada: {task.tecnico} / {execTaskStatusMap.get(task.auvo_task_id)}</span>)}
</div> }));
vi.mock("@/components/relatorios/HorasTrabalhadasTab", () => ({ default: ({ onDateFromChange, onDateToChange }: any) => <div>
  Intervalo de horas<button onClick={() => { onDateFromChange(new Date(2026, 6, 1)); onDateToChange(new Date(2026, 6, 7)); }}>Usar 1 a 7 de julho</button>
</div> }));
vi.mock("@/components/relatorios/ConfiguracoesTab", () => ({ default: () => null }));
import RelatoriosPage from "../pages/financeiro/RelatoriosPage";

describe("página real do Controle OS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
    mocks.referenced = [];
    const native = transferableAbortController();
    vi.stubGlobal("AbortController", native.constructor);
    vi.stubGlobal("AbortSignal", native.signal.constructor);
    mocks.invoke.mockImplementation(async (_name, { body }) => ({ data: {
      success: true, report_step: body.report_step, next_page: null, next_after: null,
      os_ids: [], budget_codes: [], auvo_task_ids: body.report_step === "os_page" ? ["79721161"] : [], upserted: 1, auvo_tarefas: 1,
    }, error: null }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RelatoriosPage />
  </QueryClientProvider>);

  it("exibe a causa real do 504, mantém as OS e libera o botão sem anunciar conclusão", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "Edge Function returned a non-2xx status code",
      context: Response.json({ code: "IDLE_TIMEOUT", message: "Request idle timeout limit (150s) reached" }, { status: 504 }) } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar OS" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("lote não teve conclusão confirmada"));
    expect(screen.getByText("OS preservadas na tela")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sincronizar OS" })).toBeEnabled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("mostra a etapa real e consulta IDs deduplicados sem intervalo de datas", async () => {
    let finishFirst: (result: any) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar OS" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("página 1"));
    expect(screen.getByRole("button", { name: "Sincronizando..." })).toBeDisabled();
    expect(mocks.success).not.toHaveBeenCalled();
    await act(async () => { finishFirst!({ data: { success: true, report_step: "os_page", next_page: null, os_ids: [], budget_codes: [], auvo_task_ids: ["79721161"] }, error: null }); });
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Sincronização concluída e dados gravados."));
    expect(screen.getByRole("status")).toHaveTextContent("Sincronização concluída:");
    const bodies = mocks.invoke.mock.calls.map(([, { body }]) => body);
    expect(bodies.filter(body => body.report_step === "os_tasks")).toEqual([{ report_step: "os_tasks", task_ids: ["79721161"], wait: true }]);
    expect(bodies.every(body => !body.reports_only && !body.start_date && !body.end_date)).toBe(true);
    expect(screen.queryByText("Intervalo de horas")).not.toBeInTheDocument();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("somente Horas usa datas e mantém pendência do dia 4 sem interromper outros dias", async () => {
    mocks.invoke.mockImplementation(async (_name, { body }) => ({ data: body.reports_only && body.start_date.endsWith("-04")
      ? { success: false, error: "Primeira página Auvo respondeu 404 após 3 tentativas" }
      : { success: true, report_step: body.report_step, next_page: null, next_after: null,
        os_ids: [], budget_codes: [], upserted: 1, auvo_tarefas: 1 }, error: null }));
    mount();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Horas Trabalhadas" }), { button: 0, ctrlKey: false });
    await screen.findByText("Intervalo de horas");
    fireEvent.click(screen.getByRole("button", { name: "Usar 1 a 7 de julho" }));
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar horas" }));
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent("Sincronização parcial:");
    expect(screen.getByRole("status")).toHaveTextContent("1 dia Auvo não confirmado");
    expect(screen.getByRole("button", { name: "Sincronizar horas" })).toBeEnabled();
    fireEvent.click(screen.getByText("Ver pendências da sincronização (1)"));
    expect(screen.getByText(/Primeira página Auvo respondeu 404 após 3 tentativas/)).toBeVisible();
    const calls = mocks.invoke.mock.calls.filter(([name]) => name === "central-sync");
    const queriedDays = calls.map(([, { body }]) => body.start_date);
    expect(queriedDays).toHaveLength(7);
    expect(queriedDays[4]).toBe("2026-07-05");
    expect(calls.every(([, { body }]) => body.reports_only === true && !body.report_step)).toBe(true);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("sincronizar uma situação também atualiza suas tarefas sem depender de datas", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar OS da aba" }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    const bodies = mocks.invoke.mock.calls.map(([, { body }]) => body);
    expect(bodies.map(body => body.report_step)).toEqual(["os_page", "os_reconcile", "os_tasks"]);
    expect(bodies[0].situacao_ids).toEqual(["7063705"]);
    expect(bodies[2].task_ids).toEqual(["79721161"]);
    expect(bodies.every(body => !body.reports_only && !body.start_date && !body.end_date)).toBe(true);
  });

  it("mostra pendência por tarefa sem apresentá-la como dia ou OS sem permissão", async () => {
    mocks.invoke.mockImplementation(async (_name, { body }) => ({ data: body.report_step === "os_tasks"
      ? { success: true, report_step: "os_tasks", auvo_tarefas: 0, upserted: 0, incomplete: true,
        warnings: [{ kind: "auvo_task", task_id: "79721161", status: 404, message: "Tarefa Auvo 79721161: resposta 404 não confirmada" }] }
      : { success: true, report_step: body.report_step, next_page: null, next_after: null,
        os_ids: ["398336240"], budget_codes: [], auvo_task_ids: ["79721161"], upserted: 1 }, error: null }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar OS da aba" }));
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent("1 tarefa Auvo não confirmada");
    fireEvent.click(screen.getByText("Ver pendências da sincronização (1)"));
    expect(screen.getByText("Tarefas Auvo não confirmadas")).toBeVisible();
    expect(screen.getByText(/Tarefa Auvo 79721161: resposta 404/)).toBeVisible();
    expect(screen.queryByText("Dias Auvo não confirmados")).not.toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it.each(["Agendada", "Finalizada"])("resolve execução base %s sem gc_os_id pelos IDs explícitos, mesmo sem checkout", async (status) => {
    mocks.rows = [{ mirror_key: "77509677::os:398336240::orc:", auvo_task_id: "77509677", gc_os_id: "398336240",
      gc_os_tarefa_os: "77509677", gc_os_tarefa_exec: "79721161", gc_os_situacao_id: "7063705", atualizado_em: "2026-09-15" }];
    mocks.referenced = [{ mirror_key: "79721161::os:::orc:", auvo_task_id: "79721161", gc_os_id: null,
      tecnico: "Fred", status_auvo: status, check_in: false, check_out: false, atualizado_em: "2026-09-15" }];
    mount();
    expect(await screen.findByText("Execução vinculada: Fred / " + status)).toBeVisible();
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.referenced[0].gc_os_id).toBeNull();
  });
});
