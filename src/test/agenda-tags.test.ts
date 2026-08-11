import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agendaMatchesTagFilter,
  agendaTagTextColor,
  normalizeAgendaTagColor,
} from "@/lib/agendaTags";

const root = resolve(__dirname, "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260811003000_agenda_custom_tags.sql"),
  "utf8",
);
const page = readFileSync(resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"), "utf8");
const manualDialog = readFileSync(
  resolve(root, "src/components/operacional/AgendamentoEquipeDialog.tsx"),
  "utf8",
);
const taskDialog = readFileSync(
  resolve(root, "src/components/operacional/TarefaAuvoDetalheDialog.tsx"),
  "utf8",
);

describe("tags personalizadas da Escala de Técnicos", () => {
  it("usa agenda_agendamentos como origem e cria somente a estrutura de tags", () => {
    expect(migration).toContain("CREATE TABLE public.tags");
    expect(migration).toContain("CREATE TABLE public.agenda_agendamento_tags");
    expect(migration).toContain("REFERENCES public.agenda_agendamentos(id) ON DELETE CASCADE");
    expect(migration).not.toMatch(/CREATE TABLE public\.agenda_agendamentos\s*\(/);
  });

  it("permite editar tags nos modais de tarefa e agendamento", () => {
    expect(manualDialog).toContain("<AgendaTagsEditor");
    expect(taskDialog).toContain("<AgendaTagsEditor");
    expect(taskDialog).toContain("useAgendaIdByTask(taskId)");
  });

  it("mostra badges e filtro multisseleção sem bloquear a escala enquanto carrega", () => {
    expect(page).toContain("Filtrar escala por tag");
    expect(page).toContain("tagsPorAgendamento");
    expect(page).toContain("agendaMatchesTagFilter");
    expect(page).toContain('"opacity-20 grayscale"');
    expect(page).not.toContain("loadingTagLinks");
  });

  it("aceita qualquer uma das tags selecionadas e mantém a tela normal sem filtro", () => {
    const itemTags = [
      { id: "rota-01" },
      { id: "cliente-x" },
    ];
    expect(agendaMatchesTagFilter(itemTags, [])).toBe(true);
    expect(agendaMatchesTagFilter(itemTags, ["outra", "rota-01"])).toBe(true);
    expect(agendaMatchesTagFilter(itemTags, ["outra"])).toBe(false);
  });

  it("normaliza cor inválida e escolhe contraste legível", () => {
    expect(normalizeAgendaTagColor("#ff8800")).toBe("#FF8800");
    expect(normalizeAgendaTagColor("laranja")).toBe("#2563EB");
    expect(agendaTagTextColor("#FFFFFF")).toBe("#111827");
    expect(agendaTagTextColor("#000000")).toBe("#FFFFFF");
  });
});
