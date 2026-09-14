import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transferableAbortController } from "node:util";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  functions: { invoke: mocks.invoke },
  from: () => {
    const query: any = { select: () => query, order: () => query, range: () => query, not: () => query,
      eq: () => query, in: () => query, abortSignal: () => query,
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) };
    return query;
  },
} }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error, warning: mocks.warning } }));
vi.mock("@/components/LastSyncBadge", () => ({ default: () => null }));
vi.mock("@/components/relatorios/OSAbertasTab", () => ({ default: () => <div>OS preservadas na tela</div> }));
vi.mock("@/components/relatorios/HorasTrabalhadasTab", () => ({ default: () => null }));
vi.mock("@/components/relatorios/ConfiguracoesTab", () => ({ default: () => null }));
import RelatoriosPage from "../pages/financeiro/RelatoriosPage";

describe("página real do Controle OS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const native = transferableAbortController();
    vi.stubGlobal("AbortController", native.constructor);
    vi.stubGlobal("AbortSignal", native.signal.constructor);
    mocks.invoke.mockImplementation(async (_name, { body }) => ({ data: {
      success: true, report_step: body.report_step, next_page: null, next_after: null,
      os_ids: [], budget_codes: [], upserted: 1, auvo_tarefas: 1,
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
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("lote não teve conclusão confirmada"));
    expect(screen.getByText("OS preservadas na tela")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sincronizar" })).toBeEnabled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("mostra a etapa real, bloqueia reenvio e só conclui após todos os lotes", async () => {
    let finishFirst: (result: any) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("página 1"));
    expect(screen.getByRole("button", { name: "Sincronizando..." })).toBeDisabled();
    expect(mocks.success).not.toHaveBeenCalled();
    await act(async () => { finishFirst!({ data: { success: true, report_step: "os_page", next_page: null, os_ids: [], budget_codes: [] }, error: null }); });
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Sincronização concluída e dados gravados."));
    expect(screen.getByRole("status")).toHaveTextContent("Sincronização concluída:");
    expect(mocks.invoke.mock.calls.length).toBeGreaterThan(11);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("segue após falha no dia 4 e mostra resultado parcial, data e causa na tela", async () => {
    mocks.invoke.mockImplementation(async (_name, { body }) => ({ data: body.reports_only && body.start_date.endsWith("-04")
      ? { success: false, error: "Primeira página Auvo respondeu 404 após 3 tentativas" }
      : { success: true, report_step: body.report_step, next_page: null, next_after: null,
        os_ids: [], budget_codes: [], upserted: 1, auvo_tarefas: 1 }, error: null }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Sincronizar" }));
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent("Sincronização parcial:");
    expect(screen.getByRole("status")).toHaveTextContent("1 dia Auvo não confirmado");
    expect(screen.getByRole("button", { name: "Sincronizar" })).toBeEnabled();
    fireEvent.click(screen.getByText("Ver pendências da sincronização (1)"));
    expect(screen.getByText(/Primeira página Auvo respondeu 404 após 3 tentativas/)).toBeVisible();
    expect(screen.getByText("OS preservadas na tela")).toBeVisible();
    const queriedDays = mocks.invoke.mock.calls.filter(([, { body }]) => body.reports_only).map(([, { body }]) => body.start_date);
    expect(queriedDays.length).toBeGreaterThanOrEqual(28);
    expect(queriedDays[4]).toMatch(/-05$/);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
