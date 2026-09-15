import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TarefasAgendadasDialog from "@/pages/financeiro/TarefasAgendadasDialog";
import { toast } from "sonner";

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: api } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? children : null,
  DialogContent: ({ children }: any) => <section role="dialog">{children}</section>,
  DialogDescription: ({ children }: any) => children, DialogHeader: ({ children }: any) => children,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => children,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
const tasks = [{ id: "79667772", tipo: "Execução", data: "2026-09-17", tecnico: "Executor" }];

beforeEach(() => {
  vi.clearAllMocks();
  api.invoke.mockImplementation(async (_name, { body }) => ({ data: body.action === "get"
    ? { data: { taskID: 79667772, taskDate: "2026-09-17T08:00:00", idUserTo: 123, estimatedDuration: "00:00:00" } }
    : { success: true }, error: null }));
});

describe("reagendamento de tarefa com duração Auvo pendente", () => {
  it("salva data/técnico sem enviar nem exigir uma duração não editada", async () => {
    const updated = vi.fn();
    render(<TarefasAgendadasDialog open onOpenChange={vi.fn()} equipamento="Forno" tarefas={tasks} onUpdated={updated} />);
    const save = await screen.findByRole("button", { name: "Salvar no Auvo" });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-09-18" } });
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(updated).toHaveBeenCalled());
    const request = api.invoke.mock.calls.find(([, args]) => args.body.action === "edit-schedule")![1].body;
    expect(request).not.toHaveProperty("durationMinutes");
    expect(request.taskDate).toBe("2026-09-18T08:00:00");
    expect(toast.success).toHaveBeenCalled();
  });
  it("exige confirmação quando o usuário digita duração, mesmo com HTTP/success positivo", async () => {
    const updated = vi.fn();
    render(<TarefasAgendadasDialog open onOpenChange={vi.fn()} equipamento="Forno" tarefas={tasks} onUpdated={updated} />);
    const save = await screen.findByRole("button", { name: "Salvar no Auvo" });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "150" } });
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("02:30")));
    expect(updated).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    const request = api.invoke.mock.calls.find(([, args]) => args.body.action === "edit-schedule")![1].body;
    expect(request.durationMinutes).toBe(150);
    expect(request).not.toHaveProperty("taskDate");
    expect(request).not.toHaveProperty("idUserTo");
  });
});
