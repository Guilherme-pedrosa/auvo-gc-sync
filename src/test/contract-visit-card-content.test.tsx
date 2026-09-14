import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";
import { ContractVisitCardContent, ContractVisitDetailsDialog, contractVisitCardTitle, summarizeContractVisitForTechnician } from "@/components/operacional/ContractVisitCardContent";

const item: AgendaAgendamento = {
  id: "visit", cliente: "RESTAURANTE EXEMPLO LTDA", data: "2026-09-14", hora_inicio: "08:00", hora_fim: "12:00",
  colaborador_id: "tecnico-a", colaborador_nome: "TECNICO A", veiculo_id: null, descricao: "Descrição detalhada da visita", status: "PREVISAO",
  previsao_tipo: "CONTRATO", contrato_nome: "HIGIENIZAÇÃO COIFA RESTAURANTE EXEMPLO", contrato_tipo_nome: "Higienização de coifas", contrato_visita_numero: 2,
  contrato_visita_competencia: "2026-09-01", contrato_visitas_cumpridas: 1, contrato_visitas_previstas: 2,
  contrato_horas_cumpridas: 4, contrato_horas_previstas: 8, contrato_visita_ultima_realizada_em: "2026-09-03",
};
afterEach(cleanup);

describe("resumo compacto de visita contratual", () => {
  it("mantém cliente, atividade, número, status e progresso sem repetir os totais", () => {
    const { container } = render(<ContractVisitCardContent item={item} />);
    expect(screen.getByText("RESTAURANTE EXEMPLO LTDA")).toBeTruthy();
    expect(screen.getByText("Coifas")).toBeTruthy();
    expect(screen.getByText("2ª visita")).toBeTruthy();
    expect(screen.getByText("Prevista")).toBeTruthy();
    expect(screen.getAllByText("1/2 visitas · 4h/8h")).toHaveLength(1);
    expect(container.textContent).not.toContain("Contrato seguido");
    expect(contractVisitCardTitle(item)).toContain("03/09/2026");
    expect(contractVisitCardTitle(item)).toContain("HIGIENIZAÇÃO COIFA RESTAURANTE EXEMPLO");
  });

  it("distingue dutos de coifas mesmo compartilhando o tipo cadastrado", () => {
    render(<ContractVisitCardContent item={{ ...item, contrato_nome: "HIGIENIZAÇÃO DUTOS COZINHA EXEMPLO" }} />);
    expect(screen.getByText("Dutos")).toBeTruthy();
    expect(screen.queryByText("Coifas")).toBeNull();
  });

  it("oferece detalhe acessível de execução sem permitir editar a execução", () => {
    const edit = vi.fn();
    render(<ContractVisitDetailsDialog item={{ ...item, previsao_tipo: "CONTRATO_REALIZADO", contrato_visita_tarefa_ids: ["123"], contrato_visita_horas_realizadas: 4 }} onClose={vi.fn()} onEdit={edit} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Descrição detalhada da visita")).toBeTruthy();
    expect(screen.getByText("#123")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editar previsão" })).toBeNull();
    expect(edit).not.toHaveBeenCalled();
  });

  it("mantém o acesso à edição das previsões", () => {
    const edit = vi.fn();
    const close = vi.fn();
    render(<ContractVisitDetailsDialog item={item} onClose={close} onEdit={edit} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar previsão" }));
    expect(close).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledWith(item);
  });

  it("mostra o progresso cumprido e permite editar a previsão preservada após a execução", () => {
    const fulfilled: AgendaAgendamento = {
      ...item,
      status: "CUMPRIDA_NO_MES",
      contrato_visita_execucao_id: "execution",
      contrato_visita_realizada_em: "2026-09-03",
      contrato_visitas_cumpridas: 2,
      contrato_horas_cumpridas: 8,
    };
    const { rerender } = render(<ContractVisitCardContent item={fulfilled} />);
    expect(screen.getByText("Coifas")).toBeTruthy();
    expect(screen.getByText("Realizada")).toBeTruthy();
    expect(screen.getByText("2/2 visitas · 8h/8h")).toBeTruthy();
    expect(screen.getByTitle("Carga mensal cumprida")).toBeTruthy();

    const edit = vi.fn();
    const close = vi.fn();
    rerender(<ContractVisitDetailsDialog item={fulfilled} onClose={close} onEdit={edit} />);
    expect(screen.getByText("HIGIENIZAÇÃO COIFA RESTAURANTE EXEMPLO")).toBeTruthy();
    expect(screen.getByText("Progresso no mês")).toBeTruthy();
    expect(screen.getByText("2/2 visitas · 8h/8h")).toBeTruthy();
    expect(screen.getByText("14/09/2026 · 08:00–12:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Editar previsão" }));
    expect(close).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledWith(fulfilled);
  });

  it("não atribui as horas da equipe ao técnico cujo detalhe reconhecido é zero", () => {
    const summary = summarizeContractVisitForTechnician({ ...item, contrato_visita_horas_realizadas: 8, contrato_visita_tarefas_detalhes: [
      { tecnico: "TECNICO A", tarefa_id: "123", horas: 0 },
      { tecnico: "TECNICO B", tarefa_id: "124", horas: 8 },
    ] });
    expect(summary).toEqual({ hours: 0, taskIds: ["123"], technicianMatched: true });
  });
});
