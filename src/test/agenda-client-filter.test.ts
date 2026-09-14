import { describe, expect, it } from "vitest";
import { agendaClientNames, agendaMatchesClientFilter, agendaVisibleCollaborators, type AgendaClientFilter } from "@/lib/agendaClientFilter";

const clientFilter: AgendaClientFilter = {
  kind: "cliente", id: "rh-exemplo", names: agendaClientNames({ nome: "EXEMPLO RESTAURANTE LTDA", nome_auvo: "EXEMPLO RESTAURANTE" }),
};

describe("filtro de cliente da agenda", () => {
  it("mantém as visitas de manutenção e coifa do cliente selecionado no RH", () => {
    for (const contrato_id of ["contrato-exemplo", "contrato-coifa-exemplo"]) {
      expect(agendaMatchesClientFilter({ cliente: "EXEMPLO RESTAURANTE", contrato_id }, clientFilter)).toBe(true);
    }
  });

  it("ao escolher contrato mantém somente seus cards e tarefas do cliente correspondente", () => {
    const filter: AgendaClientFilter = { kind: "contrato", id: "coifa-exemplo", names: clientFilter.names };
    expect(agendaMatchesClientFilter({ cliente: "EXEMPLO RESTAURANTE", contrato_id: "coifa-exemplo" }, filter)).toBe(true);
    expect(agendaMatchesClientFilter({ cliente: "EXEMPLO RESTAURANTE", contrato_id: "preventiva-exemplo" }, filter)).toBe(false);
    expect(agendaMatchesClientFilter({ cliente: "EXEMPLO RESTAURANTE" }, filter)).toBe(true);
    expect(agendaMatchesClientFilter({ cliente: "COZINHA OUTRA" }, filter)).toBe(false);
  });

  it("preserva unidades distintas e usa os aliases oficiais", () => {
    const filter: AgendaClientFilter = { kind: "cliente", id: "rh", names: agendaClientNames({ nome: "PIZZARIA NORTE", nome_gc: "PIZZARIA NORTE MATRIZ LTDA" }) };
    expect(agendaMatchesClientFilter({ cliente: "PIZZARIA SUL" }, filter)).toBe(false);
    expect(agendaMatchesClientFilter({ cliente: "PIZZARIA NORTE MATRIZ" }, filter)).toBe(true);
    expect(agendaMatchesClientFilter({ cliente: "Outro cliente" }, null)).toBe(true);
  });
});

describe("colaboradores visíveis na agenda", () => {
  it("exibe colaborador ativo com visita mesmo sem cargo cadastrado, preservando exclusão de inativos", () => {
    const people = [
      { id: "tecnico", nome: "Colaborador A", ativo: true, cargo: "TÉCNICO" },
      { id: "sem-cargo", nome: "Colaborador B", ativo: true, cargo: null },
      { id: "admin", nome: "Escritório", ativo: true, cargo: "Administrativo" },
      { id: "inativo", nome: "Antigo", ativo: false, cargo: "Técnico" },
    ];
    expect(agendaVisibleCollaborators(people, [{ colaborador_id: "sem-cargo" }, { colaborador_id: "inativo" }]).map((person) => person.id))
      .toEqual(["tecnico", "sem-cargo"]);
  });
});
