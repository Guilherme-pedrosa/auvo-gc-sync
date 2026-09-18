import { describe, expect, it } from "vitest";
import { regroupTrackingByAuvoAssignee } from "@/lib/realtime-tracking-normalizer";

const summary = {
  total: 0,
  finalizadas: 0,
  emAndamento: 0,
  agendadas: 0,
  atrasadas: 0,
};

describe("regroupTrackingByAuvoAssignee", () => {
  it("corrige a resposta antiga agrupada pelo vendedor do GC", () => {
    const result = regroupTrackingByAuvoAssignee({
      data: "2026-08-07",
      total_tarefas: 3,
      total_tecnicos: 1,
      total_atrasadas: 0,
      tecnicos: [
        {
          id: "vend::angelica",
          nome: "Angélica",
          resumo: summary,
          tarefas: [
            { taskId: "77245340", status: "Em andamento", atrasada: false, _auvoTechId: "184612", _auvoTechName: "Fred Bessa" },
            { taskId: "78099036", status: "Finalizada", atrasada: false, _auvoTechId: "207034", _auvoTechName: "Ayrton Carvalho" },
            { taskId: "78086408", status: "Agendada", atrasada: false, _auvoTechId: "192262", _auvoTechName: "Elton" },
          ],
        },
      ],
    });

    expect(result.tecnicos.map((group) => group.nome)).toEqual([
      "Fred Bessa",
      "Ayrton Carvalho",
      "Elton",
    ]);
    expect(result.tecnicos.find((group) => group.nome === "Ayrton Carvalho")?.tarefas[0]).toMatchObject({
      taskId: "78099036",
      gcVendedor: "Angélica",
    });
    expect(result.total_tarefas).toBe(3);
    expect(result.total_tecnicos).toBe(3);
  });

  it("preserva grupos já baseados no responsável do Auvo", () => {
    const result = regroupTrackingByAuvoAssignee({
      data: "2026-08-07",
      total_tarefas: 1,
      total_tecnicos: 1,
      total_atrasadas: 0,
      tecnicos: [
        {
          id: "auvo::184612",
          nome: "Fred Bessa",
          resumo: summary,
          tarefas: [{ taskId: "77245340", status: "Em andamento", atrasada: false }],
        },
      ],
    });

    expect(result.tecnicos).toHaveLength(1);
    expect(result.tecnicos[0]).toMatchObject({ id: "auvo::184612", nome: "Fred Bessa" });
  });

  it("não transforma vendedor em técnico quando o responsável Auvo não veio", () => {
    const result = regroupTrackingByAuvoAssignee({
      data: "2026-08-07",
      total_tarefas: 1,
      total_tecnicos: 1,
      total_atrasadas: 0,
      tecnicos: [
        {
          id: "vend::maria",
          nome: "Maria Eduarda",
          resumo: summary,
          tarefas: [{ taskId: "sem-tecnico", status: "Agendada", atrasada: false }],
        },
      ],
    });

    expect(result.tecnicos[0].nome).toBe("Sem técnico");
    expect((result.tecnicos[0].tarefas[0] as { gcVendedor?: string }).gcVendedor).toBe("Maria Eduarda");
  });
});

const task = (taskId: string, extra: Record<string, unknown> = {}) => ({
  taskId, status: "Agendada", atrasada: false, ...extra,
});
const payload = (tecnicos: any[]) => ({
  total_tarefas: tecnicos.reduce((n, t) => n + t.tarefas.length, 0),
  total_tecnicos: tecnicos.length,
  total_atrasadas: 0,
  tecnicos,
});

describe("Agenda de Técnicos — edge publicada em 15/09/2026 (grupos por técnico Auvo com userID puro)", () => {
  it("mantém um cartão por técnico em vez de jogar tudo em Sem técnico", () => {
    // Formato real devolvido pela edge realtime-tracking: id "192262", nome "Elton", tarefas sem _auvoTechId.
    const result = regroupTrackingByAuvoAssignee(payload([
      { id: "192262", nome: "Elton", resumo: summary, tarefas: [task("1", { status: "Em andamento" }), task("2")] },
      { id: "204602", nome: "Daniel Bean", resumo: summary, tarefas: [task("3", { gcVendedor: "ANGÉLICA" })] },
    ]));
    expect(result.total_tecnicos).toBe(2);
    expect(result.tecnicos.map((t) => [t.id, t.nome, t.tarefas.length])).toEqual([
      ["auvo::192262", "Elton", 2],
      ["auvo::204602", "Daniel Bean", 1],
    ]);
    expect(result.tecnicos[0].resumo).toEqual({ total: 2, finalizadas: 0, emAndamento: 1, agendadas: 1, atrasadas: 0 });
    expect(result.tecnicos.some((t) => t.nome === "Sem técnico")).toBe(false);
    // vendedor do GC continua só como informação comercial da tarefa
    expect(result.tecnicos[1].tarefas[0].gcVendedor).toBe("ANGÉLICA");
  });

  it("campos por tarefa vencem o grupo quando os dois vierem", () => {
    const result = regroupTrackingByAuvoAssignee(payload([
      { id: "207034", nome: "Ayrton Carvalho", resumo: summary, tarefas: [task("1"), task("2", { _auvoTechId: "238920", _auvoTechName: "Antonio Marcio" })] },
    ]));
    expect(result.tecnicos.map((t) => [t.id, t.nome, t.tarefas.length])).toEqual([
      ["auvo::207034", "Ayrton Carvalho", 1],
      ["auvo::238920", "Antonio Marcio", 1],
    ]);
  });

  it("grupo sem id e sem responsável nas tarefas cai em Sem técnico, sem quebrar contadores", () => {
    const result = regroupTrackingByAuvoAssignee(payload([
      { id: "", nome: "", resumo: summary, tarefas: [task("1", { atrasada: true })] },
    ]));
    expect(result.tecnicos).toHaveLength(1);
    expect(result.tecnicos[0]).toMatchObject({ id: "auvo-name::sem tecnico", nome: "Sem técnico" });
    expect(result.total_atrasadas).toBe(1);
  });
});
