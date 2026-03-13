import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowRight } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">WeDo Command Center</h1>
        <p className="text-muted-foreground mt-1">Painel de integrações e automações</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate("/financeiro/auvo-sync")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <RefreshCw className="h-5 w-5" />
              Auvo → GC Sync
            </CardTitle>
            <CardDescription>
              Automação de fechamento de OS com validação de peças e mapeamento de vendedores
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full">
              Acessar <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate("/financeiro/dashboard-tecnicos")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              📊 Dashboard Técnicos
            </CardTitle>
            <CardDescription>
              Visão geral de desempenho dos técnicos com métricas de OS, tempo e produtividade
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full">
              Acessar <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate("/financeiro/kanban-orcamentos")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              📋 Kanban Orçamentos
            </CardTitle>
            <CardDescription>
              Tarefas com pedido de peças → acompanhamento de orçamentos no GestãoClick
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full">
              Acessar <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Index;
