import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";
import type { AgendaTag } from "@/hooks/operacional/useAgendaTags";
import { buildAgendaContractIndicators } from "@/lib/agendaContractIndicators";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: db.from, rpc: db.rpc, functions: { invoke: db.invoke } },
}));
// A célula usa os componentes reais de resumo e detalhe contratual. Estes
// diálogos pertencem à página completa, fora do comportamento sob teste.
vi.mock("@/components/operacional/AgendamentoEquipeDialog", () => ({ default: () => null }));
vi.mock("@/components/operacional/TarefaAuvoDetalheDialog", () => ({ default: () => null }));
vi.mock("@/components/operacional/CriarTarefaGeralDialog", () => ({ default: () => null }));
vi.mock("@/components/operacional/AgendaRelatorioDialog", () => ({ default: () => null }));

import { Celula } from "@/pages/operacional/AgendamentoEquipePage";

function activities(): AgendaAgendamento[] {
  const items = Array.from({ length: 8 }, (_, index): AgendaAgendamento => ({
    id: `activity-${index}`, cliente: `Cliente atividade ${index}`, data: "2026-09-14",
    hora_inicio: "08:00", hora_fim: "09:00", colaborador_id: "technician", colaborador_nome: "Técnico exemplo",
    veiculo_id: null, descricao: null, status: index === 1 ? "PREVISAO" : "AGENDADO",
    origem: index === 1 ? "CONTRATO" : "AUVO", auvo_task_id: index === 1 ? null : String(1000 + index),
    previsao_tipo: index === 1 ? "CONTRATO" : null, previsao_continuidade: index === 1,
    contrato_visita_numero: index === 1 ? 1 : null, contrato_tipo_nome: index === 1 ? "Higienização de coifas" : null,
  }));
  items.forEach(Object.freeze);
  Object.freeze(items);
  return items;
}

function contractFor(task: AgendaAgendamento, changes: Partial<AgendaAgendamento> = {}): AgendaAgendamento {
  return {
    ...task, id: `contract-${task.id}`, origem: "CONTRATO", auvo_task_id: null, previsao_tipo: "CONTRATO",
    status: "PREVISAO", previsao_continuidade: true, check_in_iso: null, check_out_iso: null, duracao_decimal: null,
    contrato_nome: "HIGIENIZAÇÃO COIFA COZINHA EXEMPLO", contrato_tipo_nome: "Higienização de coifas",
    contrato_visita_config_id: "config-coifa", contrato_visita_competencia: "2026-09-01", contrato_visita_numero: 1,
    contrato_visita_tarefa_ids: [String(task.auvo_task_id)], ...changes,
  };
}

function renderCell(items: AgendaAgendamento[], options: {
  tagsPorAgendamento?: Map<string, AgendaTag[]>; tagsSelecionadas?: string[];
  apenasPrevisaoOrcamento?: boolean;
  contractIndicators?: ReturnType<typeof buildAgendaContractIndicators>;
} = {}) {
  const handlers = {
    onSalvar: vi.fn(), onAbrirTarefa: vi.fn(), onAbrirAgendamento: vi.fn(),
    onNovaTarefaAuvo: vi.fn(), onPreverProximoDia: vi.fn(), onDragStart: vi.fn(), onDrop: vi.fn(),
  };
  const rendered = render(<table><tbody><tr><Celula itens={items} {...handlers} contractIndicators={options.contractIndicators}
    apenasPrevisaoOrcamento={options.apenasPrevisaoOrcamento}
    tagsPorAgendamento={options.tagsPorAgendamento ?? new Map()} tagsSelecionadas={options.tagsSelecionadas ?? []} />
  </tr></tbody></table>);
  const visibleIds = () => [...rendered.container.querySelectorAll("[data-agenda-item]")]
    .map((element) => element.getAttribute("data-agenda-item"));
  const activityButton = (id: string) => {
    const element = rendered.container.querySelector(`[data-agenda-item="${id}"]`);
    expect(element).not.toBeNull();
    return within(element as HTMLElement).getAllByRole("button")[0];
  };
  return { ...rendered, handlers, visibleIds, activityButton };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("atividades da célula real da agenda", () => {
  it("reúne três visitas vinculadas em um selo e abre a visita escolhida sem alterar horas ou tarefas", async () => {
    const task: AgendaAgendamento = {
      ...activities()[0], id: "task-79241724", auvo_task_id: "79241724", gc_os_codigo: "10169",
      cliente: "1929 TRATTORIA MODERNA", data: "2026-09-16", duracao_planejada_minutos: 60,
    };
    const plans = [4, 5, 7].map(number => contractFor(task, {
      id: `visit-${number}`, contrato_nome: "TRATTORIA MODERNA", contrato_tipo_nome: "Manutenção Preventiva",
      contrato_visita_config_id: "trattoria-config", contrato_visita_numero: number,
      data: number === 7 ? task.data : "2026-09-08",
      contrato_visita_execucao_id: number === 7 ? null : `execution-${number}`,
      contrato_visita_realizada_em: number === 7 ? null : "2026-09-08",
      contrato_visita_tarefas_detalhes: number === 7 ? [] : [{ tarefa_id: `other-${number}`, horas: 4 }],
    }));
    const source = [task, ...plans];
    source.forEach(Object.freeze);
    Object.freeze(source);
    const before = JSON.stringify(source);
    const contractIndicators = buildAgendaContractIndicators(source);
    expect(contractIndicators.indicatorsByItemId.get(task.id)).toHaveLength(3);
    const { container, handlers, activityButton, visibleIds } = renderCell([task], { contractIndicators });
    expect(visibleIds()).toEqual([task.id]);
    const badges = container.querySelectorAll("[data-contract-visit-recognition]");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("Contrato");
    expect(badges[0]).not.toHaveAttribute("draggable", "true");
    const hoursBefore = screen.getByTitle("Abrir resumo de horas do dia").textContent;
    fireEvent.keyDown(badges[0], { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /7ª visita/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "7ª visita · 1929 TRATTORIA MODERNA" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Editar previsão" }));
    expect(handlers.onAbrirAgendamento).toHaveBeenCalledWith(plans[2]);
    fireEvent.click(activityButton(task.id));
    expect(handlers.onAbrirTarefa).toHaveBeenCalledWith(task);
    expect(screen.getByTitle("Abrir resumo de horas do dia").textContent).toBe(hoursBefore);
    expect(handlers.onSalvar).not.toHaveBeenCalled();
    expect(handlers.onDragStart).not.toHaveBeenCalled();
    expect(JSON.stringify(source)).toBe(before);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("destaca a reserva de saldo no filtro Previsão Orç. e mantém a edição disponível", () => {
    const task = activities()[0];
    const forecast: AgendaAgendamento = {
      ...task, id: "saldo-5334", origem: "MANUAL", auvo_task_id: null,
      status: "PREVISAO", previsao_continuidade: true, previsao_tipo: "SALDO_BAIXA_PARCIAL",
      gc_orcamento_codigo: "5334", gc_os_codigo: "9044",
    };
    const { container, handlers, activityButton } = renderCell([forecast, task], { apenasPrevisaoOrcamento: true });
    const forecastCard = container.querySelector('[data-agenda-item="saldo-5334"]');
    expect(forecastCard).toHaveClass("ring-2");
    expect(forecastCard).not.toHaveClass("opacity-20");
    expect(container.querySelector(`[data-agenda-item="${task.id}"]`)).toHaveClass("opacity-20");
    fireEvent.click(activityButton(forecast.id));
    expect(handlers.onAbrirAgendamento).toHaveBeenCalledWith(forecast);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("expande oito atividades a partir de cinco e recolhe sem alterar os dados nem salvar", () => {
    const items = activities();
    const before = JSON.stringify(items);
    const { visibleIds, handlers } = renderCell(items);
    const firstFive = items.slice(0, 5).map((item) => item.id);
    expect(visibleIds()).toEqual(firstFive);
    const expand = screen.getByRole("button", { name: "Ver mais 3 atividades" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    expect(visibleIds()).toEqual(items.map((item) => item.id));
    const collapse = screen.getByRole("button", { name: "Recolher atividades" });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    expect(visibleIds()).toEqual(firstFive);
    expect(screen.getByRole("button", { name: "Ver mais 3 atividades" })).toBeTruthy();
    expect(JSON.stringify(items)).toBe(before);
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("mantém a ordem e o limite ao destacar uma tag de atividade inicialmente recolhida", () => {
    const items = activities();
    const tag = { id: "urgent", name: "Urgente", color: "#ef4444" } as AgendaTag;
    const { visibleIds } = renderCell(items, { tagsPorAgendamento: new Map([["activity-7", [tag]]]), tagsSelecionadas: [tag.id] });
    expect(visibleIds()).toEqual(items.slice(0, 5).map((item) => item.id));
    expect(screen.queryByText("Urgente")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver mais 3 atividades" }));
    expect(visibleIds()).toEqual(items.map((item) => item.id));
    expect(screen.getByText("Urgente")).toBeTruthy();
  });

  it("preserva abertura de tarefas, edição de previsão e arraste inclusive depois de expandir", () => {
    const items = activities();
    const { handlers, activityButton } = renderCell(items);
    fireEvent.click(activityButton("activity-0"));
    expect(handlers.onAbrirTarefa).toHaveBeenLastCalledWith(items[0]);
    fireEvent.click(activityButton("activity-1"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(handlers.onAbrirAgendamento).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Editar previsão" }));
    expect(handlers.onAbrirAgendamento).toHaveBeenLastCalledWith(items[1]);
    fireEvent.dragStart(activityButton("activity-1"));
    expect(handlers.onDragStart).toHaveBeenLastCalledWith(items[1]);
    fireEvent.click(screen.getByRole("button", { name: "Ver mais 3 atividades" }));
    fireEvent.click(activityButton("activity-7"));
    expect(handlers.onAbrirTarefa).toHaveBeenLastCalledWith(items[7]);
    fireEvent.dragStart(activityButton("activity-7"));
    expect(handlers.onDragStart).toHaveBeenLastCalledWith(items[7]);
    expect(handlers.onSalvar).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("substitui somente a faixa com ID vinculado por um selo clicável na tarefa", () => {
    const task = activities()[0];
    const plan = contractFor(task);
    const unlinked = contractFor(task, { id: "unlinked-plan", contrato_visita_config_id: "other-config", contrato_visita_tarefa_ids: [] });
    const { visibleIds, handlers, activityButton } = renderCell([plan, unlinked, task]);
    expect(visibleIds()).toEqual([unlinked.id, task.id]);
    const badge = screen.getByRole("button", { name: `Conta no contrato · Coifas · ${task.cliente}` });
    expect(screen.queryByRole("button", { name: /^Contabilizado/ })).toBeNull();
    fireEvent.dragStart(badge);
    expect(handlers.onDragStart).toHaveBeenCalledWith(plan);
    fireEvent.click(badge);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("HIGIENIZAÇÃO COIFA COZINHA EXEMPLO")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prever continuação" }));
    expect(handlers.onPreverProximoDia).toHaveBeenCalledWith(plan);
    fireEvent.click(screen.getByRole("button", { name: `Conta no contrato · Coifas · ${task.cliente}` }));
    fireEvent.click(screen.getByRole("button", { name: "Editar previsão" }));
    expect(handlers.onAbrirAgendamento).toHaveBeenCalledWith(plan);
    fireEvent.click(activityButton(task.id));
    expect(handlers.onAbrirTarefa).toHaveBeenCalledWith(task);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it.each([false, true])("usa contabilização da tarefa exata, sem inferir pelo estado da visita (reconhecida=%s)", (recognized) => {
    const task = { ...activities()[0], status_auvo: "Finalizada" };
    const plan = contractFor(task, {
      contrato_visita_execucao_id: "execution", contrato_visita_realizada_em: task.data,
      contrato_visita_tarefas_detalhes: [{ tarefa_id: recognized ? task.auvo_task_id : "99999", horas: 1 }],
    });
    const { visibleIds } = renderCell([plan, task]);
    expect(visibleIds()).toEqual([task.id]);
    const label = recognized ? "Contabilizado" : "Aguardando validação";
    expect(screen.getByRole("button", { name: `${label} · Coifas · ${task.cliente}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(`^${recognized ? "Aguardando validação" : "Contabilizado"}`) })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Conta no contrato/ })).toBeNull();
  });

  it("preserva a faixa com tags mesmo quando a tarefa já tem selo contratual", () => {
    const task = activities()[0];
    const plan = contractFor(task);
    const tag = { id: "review", name: "Conferir visita", color: "#ef4444" } as AgendaTag;
    const { visibleIds, activityButton } = renderCell([plan, task], {
      tagsPorAgendamento: new Map([[plan.id, [tag]]]), tagsSelecionadas: [tag.id],
    });
    expect(visibleIds()).toEqual([plan.id, task.id]);
    expect(screen.getByText("Conferir visita")).toBeTruthy();
    expect(screen.getByRole("button", { name: `Conta no contrato · Coifas · ${task.cliente}` })).toBeTruthy();
    fireEvent.click(activityButton(plan.id));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("calcula horas de todas as oito tarefas ao recolher ou consolidar a faixa contratual", () => {
    const tasks = activities().map((item, index) => ({
      ...item, auvo_task_id: String(2000 + index), origem: "AUVO", previsao_tipo: null, previsao_continuidade: false,
      status: "FINALIZADA", duracao_planejada_minutos: 60, duracao_decimal: 1,
      check_in_iso: "2026-09-14T08:00:00Z", check_out_iso: "2026-09-14T09:00:00Z",
    }));
    const plan = contractFor(tasks[7]);
    const { visibleIds } = renderCell([plan, ...tasks]);
    expect(visibleIds()).toEqual(tasks.slice(0, 5).map((task) => task.id));
    expect(screen.getByTitle("Abrir resumo de horas do dia").textContent).toBe("Prev. 8h · Real 8h");
    fireEvent.click(screen.getByRole("button", { name: "Ver mais 3 atividades" }));
    expect(visibleIds()).toEqual(tasks.map((task) => task.id));
    expect(screen.getByRole("button", { name: `Conta no contrato · Coifas · ${tasks[7].cliente}` })).toBeTruthy();
    expect(screen.getByTitle("Abrir resumo de horas do dia").textContent).toBe("Prev. 8h · Real 8h");
    fireEvent.click(screen.getByRole("button", { name: "Recolher atividades" }));
    expect(screen.getByTitle("Abrir resumo de horas do dia").textContent).toBe("Prev. 8h · Real 8h");
  });

  it("usa o mapa global para mostrar execução antecipada e editar a previsão na data nominal", () => {
    const task = { ...activities()[0], data: "2026-09-15", status_auvo: "Finalizada" };
    const plan = contractFor(task, {
      data: "2026-09-16", contrato_visita_execucao_id: "early-execution", contrato_visita_realizada_em: "2026-09-15",
      contrato_visita_tarefas_detalhes: [{ tarefa_id: task.auvo_task_id, horas: 1 }],
    });
    Object.freeze(task);
    Object.freeze(plan);
    const snapshot = JSON.stringify([plan, task]);
    const contractIndicators = buildAgendaContractIndicators([plan, task]);
    expect(contractIndicators.hiddenContractCardIds.has(plan.id)).toBe(false);
    const { visibleIds, handlers } = renderCell([task], { contractIndicators });
    expect(visibleIds()).toEqual([task.id]);
    fireEvent.click(screen.getByRole("button", { name: `Contabilizado · Coifas · ${task.cliente}` }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("16/09/2026 · 08:00–09:00")).toBeTruthy();
    expect(screen.getAllByText("15/09/2026").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Editar previsão" }));
    expect(handlers.onAbrirAgendamento).toHaveBeenCalledOnce();
    expect(handlers.onAbrirAgendamento.mock.calls[0][0]).toBe(plan);
    expect(handlers.onAbrirTarefa).not.toHaveBeenCalled();
    expect(handlers.onSalvar).not.toHaveBeenCalled();
    expect(JSON.stringify([plan, task])).toBe(snapshot);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("mostra cliente e OS e mantém situação GC e ID Auvo acessíveis sem mudar a data", () => {
    const task: AgendaAgendamento = {
      ...activities()[0], data: "2026-09-15", gc_os_codigo: "85321", gc_os_situacao: "Aguardando execução",
      auvo_task_id: "12003456", tipo_tarefa_auvo: "EXECUÇÃO", tipo_tarefa_auvo_descricao: "Execução de serviço",
      status_auvo: "Finalizada",
    };
    Object.freeze(task);
    const before = JSON.stringify(task);
    const { activityButton, handlers } = renderCell([task]);
    const button = activityButton(task.id);
    expect(within(button).getByText(task.cliente)).toBeTruthy();
    expect(within(button).getByText("OS 85321")).toBeTruthy();
    const title = button.getAttribute("title") || "";
    expect(title).toContain("12003456");
    expect(title).toContain("Aguardando execução");
    expect(title).toContain("EXECUÇÃO");
    fireEvent.click(button);
    expect(handlers.onAbrirTarefa.mock.calls[0][0]).toBe(task);
    expect(task.data).toBe("2026-09-15");
    expect(JSON.stringify(task)).toBe(before);
    expect(handlers.onSalvar).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.invoke).not.toHaveBeenCalled();
  });

  it("mostra a atividade coifa de tarefa aberta sem inventar contabilização contratual", () => {
    const task: AgendaAgendamento = {
      ...activities()[0], gc_os_codigo: "10236", auvo_task_id: "79743430", status_auvo: "Aberta",
      tipo_tarefa_auvo: "HIGIENIZAÇÃO DE COIFAS", tipo_tarefa_auvo_descricao: "HIGIENIZAÇÃO DE COIFAS",
    };
    const { activityButton } = renderCell([task]);
    const button = activityButton(task.id);
    expect(within(button).getByText("Higienização de coifas")).toBeTruthy();
    expect(within(button).getByText("OS 10236")).toBeTruthy();
    expect(button.getAttribute("title")).toContain("HIGIENIZAÇÃO DE COIFAS");
    expect(screen.queryByRole("button", { name: /^Contabilizado/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Conta no contrato/ })).toBeNull();
  });
});
