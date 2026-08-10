import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const page = readFileSync(resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"), "utf8");
const hook = readFileSync(resolve(root, "src/hooks/operacional/useAgendamentoEquipe.ts"), "utf8");
const auvoAgenda = readFileSync(resolve(root, "supabase/functions/auvo-agenda/index.ts"), "utf8");

describe("desempenho do Agendamento Equipe", () => {
  it("usa a sincronização rápida sem varrer o GestãoClick na requisição da tela", () => {
    expect(page).toContain("fast: true");
    expect(auvoAgenda).toContain("const fastMode = body.fast === true");
    expect(auvoAgenda).toContain("const hasGc = !fastMode");
  });

  it("não varre tarefas_central novamente no navegador", () => {
    expect(page).not.toContain('.from("tarefas_central")');
    expect(page).not.toContain("for (let page = 0; page < 40; page++)");
  });

  it("atualiza o RH uma única vez por sincronização", () => {
    expect(page.match(/refetchColaboradores\(\)/g)).toHaveLength(1);
  });

  it("mantém IDs estáveis e grava tarefas em lote", () => {
    expect(page).toContain("crypto.randomUUID()");
    expect(page).toContain(".upsert(upsertRows.slice");
    expect(page).not.toContain("deleteAuvoQuery");
  });

  it("mantém os dados anteriores durante a revalidação e usa cache de cinco minutos", () => {
    expect(hook).toContain("staleTime: 5 * 60 * 1000");
    expect(hook).toContain("placeholderData: (previousData) => previousData");
  });
});
