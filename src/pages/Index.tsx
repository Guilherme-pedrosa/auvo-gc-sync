import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import {
  RefreshCw, BarChart3, Kanban, ArrowRight, DollarSign, ListChecks
} from "lucide-react";

const modules = [
  {
    title: "Auvo → GC Sync",
    description: "Automação de fechamento de OS com validação de peças e mapeamento de vendedores",
    icon: RefreshCw,
    path: "/financeiro/auvo-sync",
    accent: "hsl(220, 70%, 50%)",
  },
  {
    title: "Dashboard Técnicos",
    description: "Visão geral de desempenho dos técnicos com métricas de OS, tempo e produtividade",
    icon: BarChart3,
    path: "/financeiro/dashboard-tecnicos",
    accent: "hsl(152, 60%, 40%)",
  },
  {
    title: "Kanban Orçamentos",
    description: "Tarefas com pedido de peças → acompanhamento de orçamentos no GestãoClick",
    icon: Kanban,
    path: "/financeiro/kanban-orcamentos",
    accent: "hsl(38, 92%, 50%)",
  },
  {
    title: "Kanban Personalizado",
    description: "Selecione questionários do Auvo e acompanhe tarefas em Kanban com integração GestãoClick",
    icon: ListChecks,
    path: "/financeiro/kanban-personalizado",
    accent: "hsl(262, 60%, 55%)",
  },
  {
    title: "Dashboard Orçamentos",
    description: "Métricas de valores, situações, conversão e análise por técnico dos orçamentos",
    icon: DollarSign,
    path: "/financeiro/dashboard-orcamentos",
    accent: "hsl(340, 65%, 50%)",
  },
];

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="p-6 lg:p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          Visão Geral
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Acesse os módulos de integrações e automações
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((mod) => (
          <Card
            key={mod.path}
            className="group cursor-pointer border border-border hover:border-primary/30 hover:shadow-md transition-all duration-200"
            onClick={() => navigate(mod.path)}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div
                  className="h-9 w-9 rounded-lg flex items-center justify-center mb-4"
                  style={{ backgroundColor: `${mod.accent}15` }}
                >
                  <mod.icon className="h-4.5 w-4.5" style={{ color: mod.accent }} />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-muted-foreground transition-all duration-200 -translate-x-1 group-hover:translate-x-0" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1">{mod.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                {mod.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default Index;
