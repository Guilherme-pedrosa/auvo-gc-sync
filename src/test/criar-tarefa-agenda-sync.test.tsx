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
import CriarTarefaAuvoDialog from "@/pages/financeiro/CriarTarefaAuvoDialog";
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
    if (body.action === "create-task") return { data: { success: true, taskId: "123456",
      duration: { verified: true, requestedMinutes: body.durationMinutes, actualMinutes: body.durationMinutes } }, error: null };
    throw new Error(`Unexpected action ${body.action}`);
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.restoreAllMocks(); });

describe("tarefa criada aparece na agenda sem repetir criação", () => {
  it.each([true, false])("preventiva mantém o ID criado com duração confirmada=%s", async (verified) => {
    const defaultInvoke = api.invoke.getMockImplementation()!;
    api.invoke.mockImplementation((name, args) => args.body.action === "create-preventive-task"
      ? Promise.resolve({ data: { success: true, taskId: "987654", duration: {
        verified, requestedMinutes: 150, actualMinutes: verified ? 150 : 0,
      } }, error: null }) : defaultInvoke(name, args));
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    act(() => root.render(createElement(QueryClientProvider, { client }, createElement(CriarTarefaAuvoDialog, {
      open: true, onOpenChange, onCreated,
      equipamento: { id: "equipment-1", nome: "Forno", cliente: "Cliente teste", auvo_equipment_id: "1010", htHoras: 2.5, proxima_data: "2026-09-17" },
    }))));
    await waitFor(() => expect(container.querySelector('select option[value="101"]')).not.toBeNull());
    const technician = [...container.querySelectorAll("select")].find(select => select.querySelector('option[value="101"]'))!;
    act(() => { technician.value = "101"; technician.dispatchEvent(new Event("change", { bubbles: true })); });
    const createButton = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Criar no Auvo"))!;
    expect(createButton).toBeDefined();
    act(() => createButton.click());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("987654"));
    expect(actionCalls("create-preventive-task")).toHaveLength(1);
    expect(actionCalls("create-preventive-task")[0][1].body.durationMinutes).toBe(150);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    if (verified) expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("2h30 confirmada"), expect.anything());
    else {
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("987654"), expect.objectContaining({ description: expect.stringContaining("Não crie novamente") }));
    }
  });

  it("envia 02:30 como 150 minutos no POST", async () => {
    const { onOpenChange } = await mount();
    act(() => {
      const input = container.querySelector<HTMLInputElement>("#task-duration")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "02:30");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    submit();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(actionCalls("create-task")[0][1].body.durationMinutes).toBe(150);
  });

  it("preserva o ID criado e importa a tarefa quando a duração ainda não foi confirmada", async () => {
    const defaultInvoke = api.invoke.getMockImplementation()!;
    api.invoke.mockImplementation((name, args) => args.body.action === "create-task"
      ? Promise.resolve({ data: { success: true, taskId: "123456", duration: {
        verified: false, requestedMinutes: 240, actualMinutes: 0,
      } }, error: null }) : defaultInvoke(name, args));
    const { onOpenChange, onSuccess } = await mount();
    submit();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(actionCalls("create-task")).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalledWith("123456", "2026-09-09");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/123456.*04:00.*não foi confirmada/),
      expect.objectContaining({ description: expect.stringContaining("Não crie novamente") }));
    expect(toast.error).not.toHaveBeenCalled();
  });

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
