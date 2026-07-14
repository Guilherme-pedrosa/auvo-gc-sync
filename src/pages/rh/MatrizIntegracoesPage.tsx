import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search } from "lucide-react";
import { useIntegrations, useRhClientes, useColaboradores } from "@/hooks/rh/useRh";

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  authorized: "secondary",
  sent: "default",
  blocked: "destructive",
  expired: "destructive",
};

export default function MatrizIntegracoesPage() {
  const navigate = useNavigate();
  const { data: integrations = [], isLoading } = useIntegrations();
  const { data: clientes = [] } = useRhClientes();
  const { data: colabs = [] } = useColaboradores();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const clientMap = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const colabMap = useMemo(() => new Map(colabs.map((c) => [c.id, c])), [colabs]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return integrations.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (!s) return true;
      const cli = clientMap.get(i.client_id)?.nome ?? "";
      return cli.toLowerCase().includes(s);
    });
  }, [integrations, search, statusFilter, clientMap]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Matriz de Integrações</h1>
          <p className="text-sm text-muted-foreground">Kits de documentação por cliente e técnico.</p>
        </div>
        <Button onClick={() => navigate("/rh/integracoes/nova")}>
          <Plus className="h-4 w-4 mr-2" /> Nova integração
        </Button>
      </div>

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por cliente..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="authorized">Autorizada</SelectItem>
            <SelectItem value="sent">Enviada</SelectItem>
            <SelectItem value="blocked">Bloqueada</SelectItem>
            <SelectItem value="expired">Vencida</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Técnicos</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Validada</TableHead>
              <TableHead>Enviada</TableHead>
              <TableHead>Menor venc.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma integração.</TableCell></TableRow>
            ) : rows.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{clientMap.get(i.client_id)?.nome ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {i.technician_ids.map((tid) => colabMap.get(tid)?.nome ?? tid).join(", ") || "—"}
                </TableCell>
                <TableCell><Badge variant={statusVariant[i.status]}>{i.status}</Badge></TableCell>
                <TableCell className="text-xs">{i.validated_at ? new Date(i.validated_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                <TableCell className="text-xs">{i.sent_at ? new Date(i.sent_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                <TableCell className="text-xs">{i.earliest_expiry_date ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}