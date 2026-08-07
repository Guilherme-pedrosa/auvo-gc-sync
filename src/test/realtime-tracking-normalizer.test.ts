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
