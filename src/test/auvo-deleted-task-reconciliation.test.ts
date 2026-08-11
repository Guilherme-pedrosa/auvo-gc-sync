import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findMissingAuvoTaskIds,
  isConfirmedDeletedAuvoStatus,
} from "../../supabase/functions/_shared/auvo-deleted-task-reconciliation";

const root = resolve(__dirname, "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260811203000_archive_deleted_auvo_tasks.sql"),
  "utf8",
);
const centralSync = readFileSync(resolve(root, "supabase/functions/central-sync/index.ts"), "utf8");

describe("reconciliação conservadora de tarefas excluídas no Auvo", () => {
  it("gera candidato somente em janela completamente lida", () => {
    const rows = [
      { auvo_task_id: "77193527", task_date: "2026-07-01" },
      { auvo_task_id: "77193528", task_date: "2026-07-02" },
    ];
    expect(findMissingAuvoTaskIds(rows, [], [
      { startDate: "2026-07-01", endDate: "2026-07-01", complete: true },
      { startDate: "2026-07-02", endDate: "2026-07-02", complete: false },
    ])).toEqual(["77193527"]);
  });

  it("preserva tarefa retornada e ignora chaves sintéticas do GC", () => {
    const rows = [
      { auvo_task_id: "77193527", task_date: "2026-07-01" },
      { auvo_task_id: "gc-only::123", task_date: "2026-07-01" },
    ];
    expect(findMissingAuvoTaskIds(rows, ["77193527"], [
      { startDate: "2026-07-01", endDate: "2026-07-01", complete: true },
    ])).toEqual([]);
  });

  it("exige duas respostas individuais explícitas de ausência", () => {
    expect(isConfirmedDeletedAuvoStatus(404, 404)).toBe(true);
    expect(isConfirmedDeletedAuvoStatus(404, 410)).toBe(true);
    expect(isConfirmedDeletedAuvoStatus(404, 200)).toBe(false);
    expect(isConfirmedDeletedAuvoStatus(404, 503)).toBe(false);
    expect(isConfirmedDeletedAuvoStatus(null, 404)).toBe(false);
  });

  it("arquiva e remove na mesma função transacional sem apagar o card GC", () => {
    const insertAt = migration.indexOf("INSERT INTO public.tarefas_auvo_excluidas");
    const centralDeleteAt = migration.indexOf("DELETE FROM public.tarefas_central");
    expect(insertAt).toBeGreaterThan(-1);
    expect(centralDeleteAt).toBeGreaterThan(insertAt);
    expect(migration).toContain("UPDATE public.kanban_os_cache");
    expect(migration).not.toContain("DELETE FROM public.kanban_os_cache");
    expect(migration).toContain("upper(COALESCE(origem, '')) = 'AUVO'");
  });

  it("desativa remoção após erro de paginação, gravação ou leitura local", () => {
    expect(centralSync).toContain("primeira página respondeu 404");
    expect(centralSync).toContain("gravação atual teve erro; exclusão desativada");
    expect(centralSync).toContain("leitura local incompleta");
    expect(centralSync).toContain("isConfirmedDeletedAuvoStatus(first.status, second?.status ?? null)");
  });
});
