import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import AuvoSyncPage from "./pages/financeiro/AuvoSyncPage.tsx";
import TechDashboardPage from "./pages/financeiro/TechDashboardPage.tsx";
import BudgetKanbanPage from "./pages/financeiro/BudgetKanbanPage.tsx";
import CustomKanbanPage from "./pages/financeiro/CustomKanbanPage.tsx";
import DashboardOrcamentosPage from "./pages/financeiro/DashboardOrcamentosPage.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/financeiro/auvo-sync" element={<AuvoSyncPage />} />
          <Route path="/financeiro/dashboard-tecnicos" element={<TechDashboardPage />} />
          <Route path="/financeiro/kanban-orcamentos" element={<BudgetKanbanPage />} />
          <Route path="/financeiro/kanban-personalizado" element={<CustomKanbanPage />} />
          <Route path="/financeiro/dashboard-orcamentos" element={<DashboardOrcamentosPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
