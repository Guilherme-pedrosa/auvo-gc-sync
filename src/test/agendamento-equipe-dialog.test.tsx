import { act, createElement, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => ({
  save: vi.fn(), remove: vi.fn(), invoke: vi.fn(), rpc: vi.fn(),
  error: vi.fn(), warning: vi.fn(),
  empty: [] as unknown[],
  technicians: [{ id: "tech-1", nome: "Técnico teste", ativo: true, cargo: "Técnico", auvo_user_id: "123" }],
}));

vi.mock("@/hooks/rh/useRh", () => ({
  useColaboradores: () => ({ data: effects.technicians, isLoading: false }),
}));
vi.mock("@/hooks/operacional/useAgendamentoEquipe", () => ({
  useAgendaVeiculos: () => ({ data: effects.empty }),
  useSaveAgendamento: () => ({ mutateAsync: effects.save, isPending: false }),
  useDeleteAgendamento: () => ({ mutateAsync: effects.remove }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: effects.invoke }, rpc: effects.rpc },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "auvo-task-questionnaire" ? ""
      : queryKey[0] === "previsao_gc_doc_detalhe" ? null : effects.empty,
    isLoading: false, isError: false, refetch: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: effects.error, warning: effects.warning } }));
vi.mock("@/components/operacional/AgendaTagsEditor", () => ({ default: () => null }));
vi.mock("@/components/ui/calendar", () => ({ Calendar: () => null }));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: PropsWithChildren) => children,
  PopoverTrigger: ({ children }: PropsWithChildren) => children,
  // These scenarios keep the calendar/questionnaire popovers closed.
  PopoverContent: () => null,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => open ? children : null,
  DialogContent: ({ children }: PropsWithChildren) => createElement("section", { role: "dialog" }, children),
  DialogHeader: ({ children }: PropsWithChildren) => children,
  DialogTitle: ({ children }: PropsWithChildren) => createElement("h2", null, children),
  DialogFooter: ({ children }: PropsWithChildren) => children,
}));

import AgendamentoEquipeDialog from "@/components/operacional/AgendamentoEquipeDialog";
import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";

let root: Root;
let host: HTMLDivElement;
let close: ReturnType<typeof vi.fn>;

function render(agendamento?: Partial<AgendaAgendamento>) {
  act(() => root.render(createElement(AgendamentoEquipeDialog, {
    open: true, onOpenChange: close,
    initialDate: new Date(2026, 8, 9), initialColaboradorId: "tech-1",
    agendamento: agendamento as AgendaAgendamento | undefined,
  })));
}

async function changeClient(value: string) {
  const input = host.querySelector<HTMLInputElement>("#client")!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function saveThroughUi() {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find(button => /^Salvar (previsão|agendamento)$/.test(button.textContent?.trim() ?? ""));
  expect(button).toBeDefined();
  expect(button!.disabled).toBe(false);
  await act(async () => { button!.click(); });
}

function existing(overrides: Partial<AgendaAgendamento> = {}): Partial<AgendaAgendamento> {
  return {
    id: "existing-1", data: "2026-09-09", hora_inicio: "08:00:00", hora_fim: "09:00:00",
    duracao_planejada_minutos: 60, colaborador_id: "tech-1", colaborador_nome: "Técnico teste",
    cliente: "Cliente original", descricao: "Serviço existente", status: "AGENDADO", origem: "MANUAL",
    auvo_task_id: null, previsao_continuidade: false, previsao_tipo: null,
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  effects.save.mockResolvedValue({ id: "saved-1" });
  effects.invoke.mockResolvedValue({ data: { success: true }, error: null });
  effects.rpc.mockResolvedValue({ data: null, error: null });
  close = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("salvamento pelo diálogo Agendamento Equipe", () => {
  it("marca uma previsão nova explicitamente e não cria tarefa externa", async () => {
    render();
    await changeClient("  Cliente previsão  ");
    await saveThroughUi();

    expect(effects.save).toHaveBeenCalledTimes(1);
    expect(effects.save.mock.calls[0][0]).toMatchObject({
      data: "2026-09-09", colaborador_id: "tech-1", cliente: "Cliente previsão",
      hora_inicio: "08:00:00", hora_fim: "09:00:00", duracao_planejada_minutos: 60,
      origem: "MANUAL", status: "PREVISAO", previsao_continuidade: true,
      previsao_tipo: "CONTINUACAO", auvo_task_id: null,
    });
    expect(effects.invoke).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(false);
  });

  it.each([
    { label: "agendamento manual comum", status: "AGENDADO", origem: "MANUAL", previsao_tipo: null, previsao_continuidade: false, auvo_task_id: null },
    { label: "previsão de orçamento", status: "PREVISAO", origem: "MANUAL", previsao_tipo: "ORCAMENTO_EXECUCAO", previsao_continuidade: true, auvo_task_id: null },
    { label: "tarefa Auvo convertida", status: "AGENDADO", origem: "AUVO", previsao_tipo: "ORCAMENTO_EXECUCAO", previsao_continuidade: false, auvo_task_id: "999" },
  ])("preserva identidade, status e tipo ao editar $label", async ({ label: _label, ...identity }) => {
    render(existing(identity));
    await changeClient("Nome atualizado");
    await saveThroughUi();

    expect(effects.save).toHaveBeenCalledTimes(1);
    expect(effects.save.mock.calls[0][0]).toMatchObject({
      id: "existing-1", cliente: "Nome atualizado", ...identity,
    });
    // Alterar o nome exibido não deve recriar nem reagendar uma tarefa Auvo.
    expect(effects.invoke).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(false);
  });

  it("mantém o diálogo e os dados preenchidos quando a persistência falha", async () => {
    effects.save.mockRejectedValueOnce(new Error("Falha de persistência confirmada"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render();
    await changeClient("Cliente a preservar");
    await saveThroughUi();

    expect(effects.save).toHaveBeenCalledTimes(1);
    expect(effects.error).toHaveBeenCalledWith("Falha de persistência confirmada");
    expect(close).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>("#client")?.value).toBe("Cliente a preservar");
  });
});
