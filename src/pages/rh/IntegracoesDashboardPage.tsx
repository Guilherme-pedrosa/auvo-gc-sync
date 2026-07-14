import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useIntegrations, useRhClientes, useColaboradores, useCompanyDocs, useDocumentTypes, computeDocStatus } from "@/hooks/rh/useRh";

export default function IntegracoesDashboardPage() {
  const { data: integrations = [] } = useIntegrations();
  const { data: clientes = [] } = useRhClientes();
  const { data: colabs = [] } = useColaboradores();
  const { data: companyDocs = [] } = useCompanyDocs();
  const { data: types = [] } = useDocumentTypes();

  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const kpis = useMemo(() => {
    const byStatus: Record<string, number> = { draft: 0, authorized: 0, sent: 0, blocked: 0, expired: 0 };
    for (const i of integrations) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    return byStatus;
  }, [integrations]);

  const vencendo = useMemo(() => {
    const rows: Array<{ tipo: string; nome: string; venc: string; status: string }> = [];
    for (const d of companyDocs) {
      const st = computeDocStatus(d);
      if (st === "expiring" || st === "expired") {
        rows.push({
          tipo: typeMap.get(d.document_type_id)?.name ?? "—",
          nome: "Empresa",
          venc: d.data_vencimento ?? "",
          status: st,
        });
      }
    }
    return rows.sort((a, b) => a.venc.localeCompare(b.venc));
  }, [companyDocs, typeMap]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard de Integrações</h1>
        <p className="text-sm text-muted-foreground">Visão consolidada de kits de documentação e vencimentos.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Rascunho", k: "draft" },
          { label: "Autorizadas", k: "authorized" },
          { label: "Enviadas", k: "sent" },
          { label: "Bloqueadas", k: "blocked" },
          { label: "Vencidas", k: "expired" },
        ].map(({ label, k }) => (
          <Card key={k} className="p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold">{kpis[k] ?? 0}</div>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Vencimentos próximos / vencidos</h2>
        <div className="border rounded-lg bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Titular</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vencendo.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Sem pendências.</TableCell></TableRow>
              ) : vencendo.map((v, i) => (
                <TableRow key={i}>
                  <TableCell>{v.tipo}</TableCell>
                  <TableCell>{v.nome}</TableCell>
                  <TableCell>{v.venc}</TableCell>
                  <TableCell><Badge variant={v.status === "expired" ? "destructive" : "secondary"}>{v.status}</Badge></TableCell>
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