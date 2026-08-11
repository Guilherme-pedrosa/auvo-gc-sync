import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agendaTaskSnapshotChanged,
  mergeAgendaTaskSnapshot,
} from "@/lib/agendaIncrementalSync";

const root = resolve(__dirname, "../..");

const existing = {
  id: "card-estavel",
  auvo_task_id: "78059002",
  data: "2026-08-10",
  hora_inicio: "13:21",
  hora_fim: "16:48",
  colaborador_id: "rh-daniel",
  colaborador_nome: "DANIEL BEAN ALVES DA SILVA",
  cliente: "SODEXO DO BRASIL",
  descricao: "Execução da OS",
  status: "AGENDADO",
  origem: "AUVO",
  gc_os_codigo: "9450",
  gc_orcamento_codigo: "5969",
};

describe("sincronização incremental do Agendamento Equipe", () => {
  it("mantém o mesmo card quando data ou técnico mudam no Auvo", () => {
    const merged = mergeAgendaTaskSnapshot(existing, {
      ...existing,
      id: "novo-id-que-nao-deve-ser-usado",
      data: "2026-08-11",
      colaborador_id: "rh-outro",
      colaborador_nome: "OUTRO TÉCNICO",
    });

    expect(merged.id).toBe("card-estavel");
    expect(merged.data).toBe("2026-08-11");
    expect(merged.colaborador_id).toBe("rh-outro");
  });

  it("não apaga OS, orçamento ou conteúdo quando a rodada omite campos", () => {
    const merged = mergeAgendaTaskSnapshot(existing, {
      auvo_task_id: "78059002",
      data: "2026-08-10",
      hora_inicio: null,
      hora_fim: null,
      colaborador_id: "rh-daniel",
      colaborador_nome: "DANIEL BEAN ALVES DA SILVA",
      cliente: "SEM CLIENTE",
      descricao: null,
      status: "AGENDADO",
      origem: "AUVO",
      gc_os_codigo: null,
      gc_orcamento_codigo: null,
    });

    expect(merged).toMatchObject({
      id: "card-estavel",
      cliente: "SODEXO DO BRASIL",
      hora_inicio: "13:21",
      hora_fim: "16:48",
      descricao: "Execução da OS",
      gc_os_codigo: "9450",
      gc_orcamento_codigo: "5969",
    });
  });

  it("aplica uma mudança real recebida da OS", () => {
    const merged = mergeAgendaTaskSnapshot(existing, {
      ...existing,
      gc_os_codigo: "9451",
    });

    expect(merged.gc_os_codigo).toBe("9451");
    expect(agendaTaskSnapshotChanged(existing, merged)).toBe(true);
  });

  it("não grava novamente um snapshot inalterado", () => {
    const merged = mergeAgendaTaskSnapshot(existing, { ...existing });
    expect(agendaTaskSnapshotChanged(existing, merged)).toBe(false);
  });

  it("não contém mais exclusão por ausência e recupera o vínculo no diálogo", () => {
    const page = readFileSync(resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"), "utf8");
    const central = readFileSync(resolve(root, "supabase/functions/central-sync/index.ts"), "utf8");
    const taskUpdate = readFileSync(resolve(root, "supabase/functions/auvo-task-update/index.ts"), "utf8");
    const dialog = readFileSync(resolve(root, "src/components/operacional/TarefaAuvoDetalheDialog.tsx"), "utf8");

    expect(page).not.toContain("!sourceKeys.has(taskKey(row))");
    expect(page).toContain("existingByTaskId");
    expect(page).toContain('`OS ${a.gc_os_codigo}${situacaoGc ? ` [${situacaoGc}]` : ""}`');
    expect(page).toContain('Situação GC: ${situacaoGc}');
    expect(page).toContain('a.auvo_task_id ? `Tarefa ${a.auvo_task_id}`');
    expect(central).not.toContain("Mirror Auvo: removidas");
    expect(central).not.toContain("vínculos de OS inválidos (não-73343)");
    expect(central).toContain("if (!row.gc_os_id && existing.gc_os_id)");
    expect(taskUpdate).toContain('action === "sync-local"');
    expect(taskUpdate).toContain("recuperamos a linha que ainda guarda o vínculo GC");
    expect(dialog).toContain('refetchOnMount: "always"');
    expect(dialog).toContain("relatorioTarefas/DetalheTarefa/${taskId}#");
    expect(dialog).toContain('publicTaskUrl.includes("/informacoes/tarefa/")');
    expect(dialog).toContain('"https://app.auvo.com.br"');
  });
});
