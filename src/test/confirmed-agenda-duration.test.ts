import { describe, expect, it, vi } from "vitest";
import { saveConfirmedAgendaDuration } from "@/lib/confirmedAgendaDuration";

function backend(rows: any[], error: any = null) {
  const updates: { patch: any; filters: any[] }[] = [];
  return { updates, from: vi.fn(() => {
    let update: typeof updates[number] | undefined;
    const query: any = {
      select: () => query,
      update: (patch: any) => { update = { patch, filters: [] }; updates.push(update); return query; },
      eq: (...args: any[]) => { update?.filters.push(args); return query; },
      or: () => Promise.resolve({ data: update ? null : rows, error }),
    };
    return query;
  }) };
}

describe("persistência da duração planejada confirmada", () => {
  it("atualiza somente planejado na tarefa exata e mantém previsões de saldo/histórico", async () => {
    const api = backend([{ id: "real", hora_inicio: "22:00:00", previsao_continuidade: false },
      { id: "saldo", hora_inicio: "08:00:00", previsao_continuidade: true }]);
    await saveConfirmedAgendaDuration(api, "79667772", 270);
    expect(api.updates).toEqual([{ patch: { duracao_planejada_minutos: 270, hora_fim: "02:30:00" },
      filters: [["id", "real"], ["auvo_task_id", "79667772"]] }]);
    expect(api.updates[0].patch).not.toHaveProperty("duracao_decimal");
    expect(api.updates[0].patch).not.toHaveProperty("data");
    expect(api.updates[0].patch).not.toHaveProperty("colaborador_id");
  });
  it("salva o início confirmado quando o mesmo gesto também reagenda", async () => {
    const api = backend([{ id: "real", hora_inicio: "08:00:00", previsao_continuidade: false }]);
    await saveConfirmedAgendaDuration(api, "79667772", 150, "2026-09-17T13:15:00");
    expect(api.updates[0].patch).toEqual({ duracao_planejada_minutos: 150, data: "2026-09-17", hora_inicio: "13:15:00", hora_fim: "15:45:00" });
  });
  it("propaga falha local sem inventar uma confirmação", async () => {
    const api = backend([], new Error("Leitura pendente"));
    await expect(saveConfirmedAgendaDuration(api, "79667772", 150)).rejects.toThrow("Leitura pendente");
    expect(api.updates).toHaveLength(0);
  });
});
