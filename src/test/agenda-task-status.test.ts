import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agendaVisualStatus,
  shouldHighlightPendingGcExecution,
} from "@/lib/agendaTaskStatus";

const now = new Date(2026, 7, 10, 14, 30, 0);
const root = resolve(__dirname, "../..");

describe("cores dos cards do Agendamento Equipe", () => {
  it("deixa verde apenas tarefa finalizada no Auvo e sem pendência técnica", () => {
    expect(agendaVisualStatus({
      data: "2026-08-10",
      hora_fim: "10:00",
      status_auvo: "Finalizada",
      gc_os_situacao: "EXECUTADO - AG. NEGOCIAÇÃO",
    }, now)).toBe("finalizada");

    expect(agendaVisualStatus({
      data: "2026-08-10",
      hora_fim: "10:00",
      status_auvo: "Aberta",
      gc_os_situacao: "EXECUTADO - AG. NEGOCIAÇÃO",
    }, now)).toBe("atrasada");
  });

  it("não usa a OS para transformar tarefa aberta em finalizada", () => {
    expect(agendaVisualStatus({
      data: "2026-08-11",
      hora_fim: "10:00",
      status_auvo: "Aberta",
      gc_os_situacao: "EXECUTADO",
    }, now)).toBeNull();
  });

  it("deixa pausada em amarelo escuro mesmo depois do horário", () => {
    expect(agendaVisualStatus({
      data: "2026-08-10",
      hora_fim: "08:00",
      status_auvo: "Pausada",
    }, now)).toBe("pausada");
  });

  it("só marca atraso depois de duas horas completas", () => {
    expect(agendaVisualStatus({
      data: "2026-08-10",
      hora_fim: "13:00",
      status_auvo: "Aberta",
    }, now)).toBeNull();

    expect(agendaVisualStatus({
      data: "2026-08-10",
      hora_fim: "12:00",
      status_auvo: "Aberta",
    }, now)).toBe("atrasada");
  });

  it("não deixa verde finalizada com pendência técnica", () => {
    expect(agendaVisualStatus({
      data: "2026-08-10",
      hora_fim: "10:00",
      status_auvo: "Finalizada",
      gc_os_situacao: "PENDENTE DE RETORNO",
    }, now)).toBeNull();
  });

  it("destaca situação GC quando a tarefa terminou mas a OS ainda não foi executada", () => {
    expect(shouldHighlightPendingGcExecution({
      status_auvo: "Finalizada",
      gc_os_situacao: "SERVIÇO AGUARDANDO EXECUÇÃO",
    })).toBe(true);

    expect(shouldHighlightPendingGcExecution({
      status_auvo: "Finalizada",
      gc_os_situacao: "NÃO EXECUTADO",
    })).toBe(true);

    expect(shouldHighlightPendingGcExecution({
      status_auvo: "Finalizada",
      gc_os_situacao: "EXECUTADO - AGUARDANDO NEGOCIAÇÃO FINANCEIRA",
    })).toBe(false);

    expect(shouldHighlightPendingGcExecution({
      status_auvo: "Aberta",
      gc_os_situacao: "SERVIÇO AGUARDANDO EXECUÇÃO",
    })).toBe(false);
  });

  it("usa o snapshot Auvo mais recente e exibe a legenda completa", () => {
    const hook = readFileSync(resolve(root, "src/hooks/operacional/useAgendamentoEquipe.ts"), "utf8");
    const page = readFileSync(resolve(root, "src/pages/operacional/AgendamentoEquipePage.tsx"), "utf8");

    expect(hook).toContain('.order("atualizado_em", { ascending: false })');
    expect(hook).toContain("statusAuvoConfiavel");
    expect(page).toContain("Finalizada sem pendência");
    expect(page).toContain("Atrasada há mais de 2h");
    expect(page).toContain("Pausada");
    expect(page).toContain("shouldHighlightPendingGcExecution(a)");
    expect(page).toContain("text-yellow-600");
    expect(page).not.toContain('Boolean(a.check_out_iso)');
  });
});
