import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIntegrations, useRhClientes, useColaboradores, useCompanyDocs, useDocumentTypes, computeDocStatus } from "@/hooks/rh/useRh";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Row = {
  tipo: string;
  titular: string;
  escopo: "Empresa" | "Colaborador" | "Integração";
  venc: string;
  status: "expiring" | "expired";
  dias: number;
};

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const venc = new Date(dateStr);
  return Math.floor((venc.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function IntegracoesDashboardPage() {
  const { data: integrations = [] } = useIntegrations();
  const { data: clientes = [] } = useRhClientes();
  const { data: colabs = [] } = useColaboradores();
  const { data: companyDocs = [] } = useCompanyDocs();
  const { data: types = [] } = useDocumentTypes();
  const { data: allColabDocs = [] } = useQuery({
    queryKey: ["rh_colaborador_docs_all"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("rh_colaborador_docs")
        .select("id, colaborador_id, document_type_id, data_vencimento");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; colaborador_id: string; document_type_id: string; data_vencimento: string | null }>;
    },
  });

  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const clienteMap = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const colabMap = useMemo(() => new Map(colabs.map((c) => [c.id, c])), [colabs]);

  const kpis = useMemo(() => {
    const byStatus: Record<string, number> = {
      draft: 0, docs_enviados: 0, docs_aceitos: 0, agendada: 0,
      realizada: 0, bloqueada: 0, expirada: 0,
    };
    for (const i of integrations) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    return byStatus;
  }, [integrations]);

  const vencendo = useMemo(() => {
    const rows: Row[] = [];

    for (const d of companyDocs) {
      const st = computeDocStatus(d);
      if ((st === "expiring" || st === "expired") && d.data_vencimento) {
        rows.push({
          tipo: typeMap.get(d.document_type_id)?.name ?? "—",
          titular: "Empresa",
          escopo: "Empresa",
          venc: d.data_vencimento,
          status: st,
          dias: daysUntil(d.data_vencimento),
        });
      }
    }

    for (const d of allColabDocs) {
      const st = computeDocStatus(d);
      if ((st === "expiring" || st === "expired") && d.data_vencimento) {
        const colab = colabMap.get(d.colaborador_id);
        rows.push({
          tipo: typeMap.get(d.document_type_id)?.name ?? "—",
          titular: colab?.nome_fantasia || colab?.nome || "Colaborador",
          escopo: "Colaborador",
          venc: d.data_vencimento,
          status: st,
          dias: daysUntil(d.data_vencimento),
        });
      }
    }

    for (const i of integrations) {
      const venc = i.integration_valid_until || i.earliest_expiry_date;
      if (!venc) continue;
      const st = computeDocStatus({ data_vencimento: venc });
      if (st !== "expiring" && st !== "expired") continue;
      const cli = clienteMap.get(i.client_id);
      rows.push({
        tipo: "Integração",
        titular: cli?.nome_fantasia || cli?.nome || "Cliente",
        escopo: "Integração",
        venc,
        status: st,
        dias: daysUntil(venc),
      });
    }

    return rows.sort((a, b) => a.dias - b.dias);
  }, [companyDocs, allColabDocs, integrations, typeMap, colabMap, clienteMap]);

  const totais = useMemo(() => ({
    vencidos: vencendo.filter((r) => r.status === "expired").length,
    vencendo: vencendo.filter((r) => r.status === "expiring").length,
  }), [vencendo]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard de Integrações</h1>
        <p className="text-sm text-muted-foreground">Visão consolidada de kits de documentação e vencimentos.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "Rascunho", k: "draft" },
          { label: "Docs Enviados", k: "docs_enviados" },
          { label: "Docs Aceitos", k: "docs_aceitos" },
          { label: "Agendadas", k: "agendada" },
          { label: "Realizadas", k: "realizada" },
          { label: "Bloqueadas", k: "bloqueada" },
          { label: "Expiradas", k: "expirada" },
        ].map(({ label, k }) => (
          <Card key={k} className="p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold">{kpis[k] ?? 0}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="text-xs text-muted-foreground">Vencidos (empresa + colaboradores + integrações)</div>
          <div className="text-2xl font-semibold text-destructive">{totais.vencidos}</div>
        </Card>
        <Card className="p-4 border-yellow-500/40 bg-yellow-500/5">
          <div className="text-xs text-muted-foreground">Vencendo em até 30 dias</div>
          <div className="text-2xl font-semibold text-yellow-700 dark:text-yellow-500">{totais.vencendo}</div>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Vencimentos próximos / vencidos</h2>
        <div className="border rounded-lg bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Titular</TableHead>
                <TableHead>Escopo</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vencendo.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sem pendências.</TableCell></TableRow>
              ) : vencendo.map((v, i) => (
                <TableRow key={i}>
                  <TableCell>{v.tipo}</TableCell>
                  <TableCell>{v.titular}</TableCell>
                  <TableCell><Badge variant="outline">{v.escopo}</Badge></TableCell>
                  <TableCell>{new Date(v.venc).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {v.dias < 0 ? `${Math.abs(v.dias)}d atrás` : `${v.dias}d`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={v.status === "expired" ? "destructive" : "secondary"}>
                      {v.status === "expired" ? "Vencido" : "Vencendo"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {integrations.length} integração(ões) · {clientes.length} cliente(s) · {colabs.length} colaborador(es)
      </div>
    </div>
  );
}