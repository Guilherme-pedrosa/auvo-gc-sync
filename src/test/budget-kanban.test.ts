import { describe, expect, it } from "vitest";
import {
  evaluateBudgetSyncStatus,
  moveBudgetKanbanCard,
  RESOLVED_WITHOUT_BUDGET_COLUMN,
  shouldAutoRouteToDoneToday,
} from "@/lib/budgetKanban";

type Card = { auvo_task_id: string };
type Column = { id: string; title: string; items: Card[] };

describe("budget kanban state rules", () => {
  it("never removes manually resolved cards for the Done today auto-route", () => {
    expect(shouldAutoRouteToDoneToday(
      RESOLVED_WITHOUT_BUDGET_COLUMN,
      "2026-07-14",
      "2026-07-14",
    )).toBe(false);
    expect(shouldAutoRouteToDoneToday("custom_em_analise", "2026-07-14", "2026-07-14")).toBe(false);
  });

  it("only auto-routes cards from pending system columns", () => {
    expect(shouldAutoRouteToDoneToday("a_fazer", "2026-07-14T12:00:00Z", "2026-07-14")).toBe(true);
    expect(shouldAutoRouteToDoneToday("falta_preenchimento", "2026-07-14", "2026-07-14")).toBe(true);
    expect(shouldAutoRouteToDoneToday("os_realizada", "2026-07-14", "2026-07-14")).toBe(false);
  });

  it("moves the dragged card by id when a filter changes its visible index", () => {
    const columns: Column[] = [
      {
        id: "a_fazer",
        title: "A Fazer",
        items: [
          { auvo_task_id: "hidden-card" },
          { auvo_task_id: "visible-card" },
        ],
      },
      { id: "custom", title: "Custom", items: [] },
    ];

    const moved = moveBudgetKanbanCard(
      columns,
      "visible-card",
      "custom",
      "Custom",
      0,
      [],
    );

    expect(moved[0].items.map((item) => item.auvo_task_id)).toEqual(["hidden-card"]);
    expect(moved[1].items.map((item) => item.auvo_task_id)).toEqual(["visible-card"]);
  });

  it("inserts relative to the visible destination order while preserving hidden cards", () => {
    const columns: Column[] = [
      { id: "a_fazer", title: "A Fazer", items: [{ auvo_task_id: "moving" }] },
      {
        id: "custom",
        title: "Custom",
        items: [
          { auvo_task_id: "hidden" },
          { auvo_task_id: "visible-1" },
          { auvo_task_id: "visible-2" },
        ],
      },
    ];

    const moved = moveBudgetKanbanCard(
      columns,
      "moving",
      "custom",
      "Custom",
      1,
      ["visible-1", "visible-2"],
    );

    expect(moved[1].items.map((item) => item.auvo_task_id)).toEqual([
      "hidden",
      "visible-1",
      "moving",
      "visible-2",
    ]);
  });

  it("recognizes the terminal state of the requested sync run", () => {
    expect(evaluateBudgetSyncStatus({ run_id: "run-1", status: "running" }, "run-1"))
      .toEqual({ state: "waiting" });
    expect(evaluateBudgetSyncStatus({ run_id: "run-1", status: "succeeded" }, "run-1"))
      .toEqual({ state: "succeeded" });
  });

  it("surfaces backend failures and superseded runs", () => {
    expect(evaluateBudgetSyncStatus({ run_id: "run-1", status: "failed", error: "RPC ausente" }, "run-1"))
      .toEqual({ state: "failed", message: "RPC ausente" });

    const superseded = evaluateBudgetSyncStatus(
      { run_id: "run-2", status: "running" },
      "run-1",
    );
    expect(superseded.state).toBe("failed");
    expect(superseded.message).toContain("Outra sincronização");
  });
});
