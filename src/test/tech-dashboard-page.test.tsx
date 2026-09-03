import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TechDashboardPage from "@/pages/financeiro/TechDashboardPage";
import type { TechnicianDashboardData } from "@/lib/technicianDashboard";

const technician = {
  id: "207034",
  nome: "Ayrton Carvalho",
  tarefas_total: 10,
  tarefas_finalizadas: 8,
  tarefas_abertas: 2,
  tarefas_em_execucao: 1,
  tarefas_com_pendencia: 0,
  tarefas_sem_questionario: 0,
  checkins_sem_checkout: 1,
  tarefas_nao_atendidas: 1,
  tarefas_com_formulario_incompleto: 1,
  tarefas_sem_relato: 1,
  tarefas_com_poucas_fotos: 1,
  tarefas_com_os: 8,
  qualidade_pct: 60,
  taxa_finalizacao: 80,
  media_execucoes_dia: 1.5,
  tempo_horas: 40,
  deslocamento_horas: 5,
  tempo_atividade_pct: 80,
  dias_trabalhados: 5,
  dias_uteis: 3,
  horas_disponiveis: 24,
  horas_produtivas_liquidas: 20,
  produtividade_pct: 83,
  valor_total: 5000,
  faturamento_hora: 125,
  horas_contrato: 10,
  valor_contratos: 1500,
  tarefas_por_dia: {},
  finalizadas_por_dia: {},
};

const dashboardData: TechnicianDashboardData = {
  resumo: {
    periodo: { inicio: "2026-09-01", fim: "2026-09-03" },
    total_tarefas: 10,
    total_finalizadas: 8,
    total_tecnicos: 1,
    total_horas: 40,
    total_deslocamento_horas: 5,
    dias_uteis: 3,
    horas_disponiveis: 24,
    horas_produtivas_liquidas: 20,
    produtividade_pct: 83,
    total_pendencias: 0,
    total_sem_questionario: 0,
    total_checkins_sem_checkout: 1,
    total_em_execucao: 1,
    total_nao_atendidas: 1,
    total_formularios_incompletos: 1,
    total_sem_relato: 1,
    total_poucas_fotos: 1,
    tarefas_fora_painel: 1,
    valor_total: 5000,
    total_horas_contrato: 10,
    total_valor_contratos: 1500,
  },
  tecnicos: [technician],
  divergencias: [{
    key: "207034::t1",
    taskId: "t1",
    technicianId: "207034",
    technicianName: "Ayrton Carvalho",
    client: "Cliente X",
    date: "2026-09-02",
    description: "Manutenção corretiva no forno combinado",
    gcOsCode: "1234",
    auvoUrl: "https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/t1",
    photoCount: 1,
    issues: [
      { kind: "photos", label: "Fotos insuficientes", detail: "Somente 1 foto(s) anexada(s) (mínimo operacional: 3)" },
      { kind: "report", label: "Sem relato útil", detail: "Nenhum relato técnico de execução foi encontrado nas respostas do formulário" },
    ],
  }],
  fora_painel: [{
    auvo_task_id: "t9",
    tecnico: "Maria Eduarda",
    cliente: "Cliente Y",
    data: "2026-09-01",
    motivo: "Executor fora do cadastro de técnicos do RH (cargo/função de técnico ou auxiliar)",
    auvoUrl: "https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/t9",
  }],
};

vi.mock("@/hooks/useTechnicianDashboard", () => ({
  useTechnicianDashboard: () => ({
    data: dashboardData,
    isLoading: false,
    isFetching: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePremiacaoFaturamento", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/usePremiacaoFaturamento")>();
  return {
    ...original,
    usePremiacaoFaturamento: () => ({ data: null, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
  };
});

vi.mock("@/components/LastSyncBadge", () => ({ default: () => null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TechDashboardPage />
    </QueryClientProvider>,
  );
}

describe("TechDashboardPage", () => {
  it("renders summary cards on the technician base and the quality alert total", () => {
    renderPage();

    expect(screen.getByText("Dashboard Técnicos")).toBeInTheDocument();
    expect(screen.getByText("10 tarefas no recorte")).toBeInTheDocument();
    // 1 agenda + 1 formulário + 1 relato + 1 fotos + 1 check-in esquecido
    expect(screen.getByText("Alertas de qualidade").parentElement?.textContent).toContain("5");
    expect(screen.getByText(/1 em execução agora/)).toBeInTheDocument();
  });

  it("opens the alert details dialog with reasons and Auvo link when a card is clicked", async () => {
    renderPage();

    fireEvent.click(screen.getByText("Alertas de qualidade"));

    expect(await screen.findByRole("heading", { name: "Todos os alertas" })).toBeInTheDocument();
    expect(screen.getByText(/Somente 1 foto\(s\) anexada\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/Nenhum relato técnico de execução/)).toBeInTheDocument();
    const auvoLink = screen.getByRole("link", { name: /Abrir no Auvo/ });
    expect(auvoLink).toHaveAttribute("href", "https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/t1");
    expect(screen.getByText("OS 1234")).toBeInTheDocument();
  });

  it("filters the dialog by technician when the row alert badge is clicked", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /alerta\(s\)/ }));

    expect(await screen.findByText(/Todos os alertas · Ayrton Carvalho/)).toBeInTheDocument();
    expect(screen.getByText("Ver todos os técnicos")).toBeInTheDocument();
  });

  it("lists tasks outside the dashboard with the reason when the notice is clicked", async () => {
    renderPage();

    fireEvent.click(screen.getByText("1 tarefa(s) do período fora do painel"));

    expect(await screen.findByText("Tarefas fora do painel")).toBeInTheDocument();
    expect(screen.getByText("Maria Eduarda")).toBeInTheDocument();
    expect(screen.getByText(/Executor fora do cadastro de técnicos do RH/)).toBeInTheDocument();
  });
});
