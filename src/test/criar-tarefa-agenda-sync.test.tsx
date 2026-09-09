import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: api } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { auvo_user_id: "101" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/searchable-select", async () => {
  const React = await import("react");
  return {
    SearchableSelect: ({ options, value, onValueChange, placeholder }: any) => React.createElement(
      "select", { "aria-label": placeholder, value, onChange: (event: any) => onValueChange(event.target.value) },
      React.createElement("option", { value: "" }, placeholder),
      ...options.map((option: any) => React.createElement("option", { key: option.value, value: option.value }, option.label)),
    ),
  };
});
vi.mock("@/components/ui/dialog", async () => {
  const React = await import("react");
  const wrapper = ({ children }: any) => React.createElement("div", null, children);
  return {
    Dialog: ({ open, children }: any) => open ? wrapper({ children }) : null,
    DialogContent: wrapper, DialogDescription: wrapper, DialogFooter: wrapper, DialogHeader: wrapper, DialogTitle: wrapper,
  };
});

import CriarTarefaGeralDialog from "@/components/operacional/CriarTarefaGeralDialog";
import { toast } from "sonner";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const actionCalls = (action: string) => api.invoke.mock.calls.filter(([, args]) => args.body.action === action);

async function waitFor(check: () => void) {
  for (let attempts = 0; ; attempts++) {
    try { check(); return; } catch (error) { if (attempts >= 100) throw error; }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
}
async function mount(onSuccess = vi.fn()) {
  const onOpenChange = vi.fn();
  act(() => root.render(createElement(QueryClientProvider, { client }, createElement(CriarTarefaGeralDialog, {
    open: true, onOpenChange, onSuccess, initialDate: "2026-09-09", initialUserAuvoId: "101",
  }))));
  await waitFor(() => expect(container.querySelector('select[aria-label="Selecione o cliente"] option[value="201"]')).not.toBeNull());
  await waitFor(() => expect(container.querySelector('select[aria-label="Selecione o tipo"] option[value="301"]')).not.toBeNull());
  for (const [label, value] of [["Selecione o cliente", "201"], ["Selecione o tipo", "301"]]) {
    act(() => {
      const select = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  return { onOpenChange, onSuccess };
}
function submit() {
  const button = [...container.querySelectorAll("button")].find(element => element.textContent?.includes("Criar no Auvo"));
  expect(button).toBeDefined();
  act(() => button!.click());
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  delete (window as any).queryClient;
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  api.invoke.mockImplementation(async (_name: string, { body }: any) => {
    const lists: Record<string, unknown[]> = {
      "list-customers": [{ id: 201, description: "Cliente teste" }],
      "list-task-types": [{ id: 301, description: "Manutenção" }],
      "list-users": [{ userID: 101, name: "Técnico teste" }],
      "list-questionnaires": [], "list-customer-equipments": [],
    };
    if (lists[body.action]) return { data: { data: lists[body.action] }, error: null };
    if (body.action === "create-task") return { data: { success: true, taskId: "123456" }, error: null };
    throw new Error(`Unexpected action ${body.action}`);
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); });

describe("tarefa criada aparece na agenda sem repetir criação", () => {
  it("sincroniza o ID criado antes de atualizar a grade, usando seu próprio QueryClient", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    let release!: () => void;
    const onSuccess = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const { onOpenChange } = await mount(onSuccess);
    submit();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("123456", "2026-09-09"));
    expect(invalidate).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(actionCalls("create-task")).toHaveLength(1);
    expect(actionCalls("sync-local")).toHaveLength(0);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agenda_semana"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["agenda_agendamentos"] });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it.each(["timeout", "Tarefa não encontrada na agenda importada"])("preserva a criação confirmada e avisa quando o callback falha: %s", async (message) => {
    const onSuccess = vi.fn().mockRejectedValue(new Error(message));
    const { onOpenChange } = await mount(onSuccess);
    submit();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(actionCalls("create-task")).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalledWith("123456", "2026-09-09");
    expect(actionCalls("sync-local")).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("Tarefa criada no Auvo (#123456)", expect.anything());
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("123456"), expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("não sincroniza nem anuncia criação quando o Auvo recusa o POST", async () => {
    const defaultInvoke = api.invoke.getMockImplementation()!;
    api.invoke.mockImplementation((name, args) => args.body.action === "create-task"
      ? Promise.resolve({ data: { success: false, error: "Recusado" }, error: null }) : defaultInvoke(name, args));
    const { onOpenChange } = await mount();
    submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(actionCalls("create-task")).toHaveLength(1);
    expect(actionCalls("sync-local")).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
