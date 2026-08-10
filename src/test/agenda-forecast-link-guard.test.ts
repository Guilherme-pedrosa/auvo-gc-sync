import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("proteção do vínculo entre previsão e tarefa Auvo", () => {
  const root = resolve(__dirname, "../..");
  const migration = readFileSync(
    resolve(root, "supabase/migrations/20260810203000_guard_manual_forecast_task_links.sql"),
    "utf8",
  );

  it("limpa vínculos antigos e bloqueia novas previsões contaminadas", () => {
    expect(migration).toContain("UPDATE public.agenda_agendamentos");
    expect(migration).toContain("NEW.auvo_task_id := NULL");
    expect(migration).toContain("NEW.status := 'PREVISAO'");
    expect(migration).toContain("agenda_previsao_manual_sem_tarefa_chk");
  });

  it("não interfere na promoção da previsão para uma tarefa real", () => {
    expect(migration).toContain("NEW.previsao_continuidade IS TRUE");
    expect(migration).toContain("NEW.conversao_status IS DISTINCT FROM 'CONVERTIDA'");
  });
});
