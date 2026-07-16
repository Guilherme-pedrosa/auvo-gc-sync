import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import AuvoSyncPage from "./pages/financeiro/AuvoSyncPage.tsx";
import TechDashboardPage from "./pages/financeiro/TechDashboardPage.tsx";
import BudgetKanbanPage from "./pages/financeiro/BudgetKanbanPage.tsx";
import CustomKanbanPage from "./pages/financeiro/CustomKanbanPage.tsx";
import RealtimeTrackingPage from "./pages/financeiro/RealtimeTrackingPage.tsx";
import OSKanbanPage from "./pages/financeiro/OSKanbanPage.tsx";
import AgendaSemanalPage from "./pages/financeiro/AgendaSemanalPage.tsx";
import OrcamentosControlePage from "./pages/financeiro/OrcamentosControlePage.tsx";
import UsersPage from "./pages/admin/UsersPage.tsx";
import RelatoriosPage from "./pages/financeiro/RelatoriosPage.tsx";
import OSCruzadasPage from "./pages/financeiro/OSCruzadasPage.tsx";
import OficinaKanbanPage from "./pages/financeiro/OficinaKanbanPage.tsx";
import EquipamentosPreventivosPage from "./pages/financeiro/EquipamentosPreventivosPage.tsx";
import PlanosPreventivosPage from "./pages/financeiro/PlanosPreventivosPage.tsx";
import FollowUpKanbanPage from "./pages/financeiro/FollowUpKanbanPage.tsx";
import PremiacaoPage from "./pages/financeiro/PremiacaoPage.tsx";
import ContratosPage from "./pages/configuracoes/ContratosPage.tsx";
import TiposEquipamentoPage from "./pages/configuracoes/TiposEquipamentoPage.tsx";
import TiposTarefaPreventivaPage from "./pages/configuracoes/TiposTarefaPreventivaPage.tsx";
import ClientesRhPage from "./pages/rh/ClientesRhPage.tsx";
import ClienteRequisitosPage from "./pages/rh/ClienteRequisitosPage.tsx";
import ColaboradoresPage from "./pages/rh/ColaboradoresPage.tsx";
import ColaboradorDetailPage from "./pages/rh/ColaboradorDetailPage.tsx";
import TiposDocumentoPage from "./pages/rh/TiposDocumentoPage.tsx";
import DocumentosEmpresaPage from "./pages/rh/DocumentosEmpresaPage.tsx";
import MatrizIntegracoesPage from "./pages/rh/MatrizIntegracoesPage.tsx";
import NovaIntegracaoPage from "./pages/rh/NovaIntegracaoPage.tsx";
import IntegracoesDashboardPage from "./pages/rh/IntegracoesDashboardPage.tsx";
import PacotesPadraoPage from "./pages/rh/PacotesPadraoPage.tsx";
import TreinamentosPage from "./pages/rh/TreinamentosPage.tsx";
import TreinamentoDetailPage from "./pages/rh/TreinamentoDetailPage.tsx";
import TiposTreinamentoPage from "./pages/rh/configuracoes/TiposTreinamentoPage.tsx";
import PortalLoginPage from "./pages/portal/PortalLoginPage.tsx";
import PortalHorasPage from "./pages/portal/PortalHorasPage.tsx";
import PortalOrcamentosPage from "./pages/portal/PortalOrcamentosPage.tsx";
import PortalPlanosPreventivosPage from "./pages/portal/PortalPlanosPreventivosPage.tsx";
import PortalNegociacaoPage from "./pages/portal/PortalNegociacaoPage.tsx";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isCliente, roleLoaded } = useAuth();

  // Aguarda role carregar para evitar flash de conteúdo interno para clientes
  if (loading || (user && !roleLoaded)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Clientes externos não acessam a área interna
  if (isCliente) {
    return <Navigate to="/portal/horas" replace />;
  }

  return <>{children}</>;
}

const AppRoutes = () => {
  const { user, isCliente } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={isCliente ? "/portal/horas" : "/"} replace /> : <LoginPage />}
      />
      <Route path="/portal/login" element={<PortalLoginPage />} />
      <Route path="/portal/horas" element={<PortalHorasPage />} />
      <Route path="/portal/orcamentos" element={<PortalOrcamentosPage />} />
      <Route path="/portal/planos-preventivos" element={<PortalPlanosPreventivosPage />} />
      <Route path="/portal/negociacao-financeira" element={<PortalNegociacaoPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/financeiro/auvo-sync" element={<AuvoSyncPage />} />
                <Route path="/financeiro/dashboard-tecnicos" element={<TechDashboardPage />} />
                <Route path="/financeiro/kanban-orcamentos" element={<BudgetKanbanPage />} />
                <Route path="/financeiro/kanban-personalizado" element={<CustomKanbanPage />} />
                <Route path="/financeiro/acompanhamento" element={<RealtimeTrackingPage />} />
                <Route path="/financeiro/kanban-os" element={<OSKanbanPage />} />
                <Route path="/financeiro/agenda-semanal" element={<AgendaSemanalPage />} />
                <Route path="/financeiro/relatorios" element={<RelatoriosPage />} />
                <Route path="/financeiro/controle-orcamentos" element={<OrcamentosControlePage />} />
                <Route path="/financeiro/os-cruzadas" element={<OSCruzadasPage />} />
                <Route path="/financeiro/kanban-oficina" element={<OficinaKanbanPage />} />
                <Route path="/financeiro/equipamentos-preventivos" element={<EquipamentosPreventivosPage />} />
                <Route path="/financeiro/planos-preventivos" element={<PlanosPreventivosPage />} />
                <Route path="/financeiro/kanban-followup" element={<FollowUpKanbanPage />} />
                <Route path="/financeiro/premiacao" element={<PremiacaoPage />} />
                <Route path="/configuracoes/contratos" element={<ContratosPage />} />
                <Route path="/configuracoes/tipos-equipamento" element={<TiposEquipamentoPage />} />
                <Route path="/configuracoes/tipos-tarefa-preventiva" element={<TiposTarefaPreventivaPage />} />
                <Route path="/rh/clientes" element={<ClientesRhPage />} />
                <Route path="/rh/clientes/:id/requisitos" element={<ClienteRequisitosPage />} />
                <Route path="/rh/colaboradores" element={<ColaboradoresPage />} />
                <Route path="/rh/colaboradores/:id" element={<ColaboradorDetailPage />} />
                <Route path="/rh/tipos-documento" element={<TiposDocumentoPage />} />
                <Route path="/rh/pacotes-padrao" element={<PacotesPadraoPage />} />
                <Route path="/rh/documentos-empresa" element={<DocumentosEmpresaPage />} />
                <Route path="/rh/integracoes" element={<MatrizIntegracoesPage />} />
                <Route path="/rh/integracoes/nova" element={<NovaIntegracaoPage />} />
                <Route path="/rh/integracoes/dashboard" element={<IntegracoesDashboardPage />} />
                <Route path="/rh/dashboard" element={<IntegracoesDashboardPage />} />
                <Route path="/rh/treinamentos" element={<TreinamentosPage />} />
                <Route path="/rh/treinamentos/:id" element={<TreinamentoDetailPage />} />
                <Route path="/rh/configuracoes/tipos-treinamento" element={<TiposTreinamentoPage />} />
                <Route path="/admin/usuarios" element={<UsersPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
