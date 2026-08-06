import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Share2, AlertTriangle, Loader2, CalendarClock, UserCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useIntegrations, useRhClientes, useColaboradores, useDeleteIntegration,
  useIntegrationShares, useSaveIntegrationShares, useSaveIntegration,
} from "@/hooks/rh/useRh";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  docs_enviados: "secondary",
  docs_aceitos: "secondary",
  agendada: "default",
  realizada: "default",
  bloqueada: "destructive",
  expirada: "destructive",
};

const statusLabel: Record<string, string> = {
  draft: "Rascunho",
  docs_enviados: "Docs enviados",
  docs_aceitos: "Docs aceitos",
  agendada: "Agendada",
  realizada: "Realizada",
  bloqueada: "Bloqueada",
  expirada: "Expirada",
};

const DAY_MS = 86_400_000;
const daysBetween = (iso: string | null) =>
  iso ? Math.round((Date.now() - new Date(iso).getTime()) / DAY_MS) : null;
const agingLabel = (days: number | null) => {
  if (days == null) return "—";
  if (days === 0) return "hoje";
  return days > 0 ? `há ${days} dia(s)` : `em ${Math.abs(days)} dia(s)`;
};

type DrillRow = {
  key: string;
  titulo: string;
  cliente: string;
  detalhe: string;
  agingDays: number | null;
  agingBase: string;
};

export default function MatrizIntegracoesPage() {
  const navigate = useNavigate();
  const { data: integrations = [], isLoading } = useIntegrations();
  const { data: clientes = [] } = useRhClientes();
  const { data: colabs = [] } = useColaboradores();
  const { data: shares = [] } = useIntegrationShares();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const del = useDeleteIntegration();
  const [toDelete, setToDelete] = useState<{ id: string; nome: string } | null>(null);
  const saveShares = useSaveIntegrationShares();
  const saveIntegration = useSaveIntegration();
  const [extendId, setExtendId] = useState<string | null>(null);
  const [extendSearch, setExtendSearch] = useState("");
  const [extendSelected, setExtendSelected] = useState<string[]>([]);
  const [savingExtend, setSavingExtend] = useState(false);
  const [drill, setDrill] = useState<null | "agendadas" | "ressalvas" | "tecnicos_ressalva">(null);

  const clientMap = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const colabMap = useMemo(() => new Map(colabs.map((c) => [c.id, c])), [colabs]);

  const extendIntegration = extendId ? integrations.find((i) => i.id === extendId) ?? null : null;
  const extendCandidates = useMemo(() => {
    const s = extendSearch.trim().toLowerCase();
    return clientes
      .filter((c) => c.id !== extendIntegration?.client_id)
      .filter((c) => (s ? c.nome.toLowerCase().includes(s) : true))
      .slice(0, 80);
  }, [clientes, extendSearch, extendIntegration]);

  const openExtend = (id: string) => {
    setExtendId(id);
    setExtendSearch("");
    setExtendSelected(shares.filter((s) => s.integration_id === id).map((s) => s.client_id));
  };

  const confirmExtend = async () => {
    if (!extendId) return;
    setSavingExtend(true);
    try {
      await saveIntegration.mutateAsync({
        id: extendId,
        abrangencia: extendSelected.length ? "compartilhada" : "exclusiva",
      });
      await saveShares.mutateAsync({ integration_id: extendId, client_ids: extendSelected });
      setExtendId(null);
    } finally {
      setSavingExtend(false);
    }
  };

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return integrations.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (!s) return true;
      const cli = clientMap.get(i.client_id)?.nome ?? "";
      return cli.toLowerCase().includes(s);
    });
  }, [integrations, search, statusFilter, clientMap]);

  const nomeCliente = (cid: string) => clientMap.get(cid)?.nome ?? "—";
  const nomeTec = (tid: string) => colabMap.get(tid)?.nome ?? tid;

  const agendadas = useMemo(() => integrations.filter((i) => i.status === "agendada"), [integrations]);
  const comRessalva = useMemo(() => integrations.filter((i) => i.ressalva), [integrations]);
  const tecnicosComRessalva = useMemo(() => {
    const map = new Map<string, { tid: string; integracoes: typeof integrations }>();
    for (const i of integrations) {
      if (!i.ressalva || i.status !== "realizada") continue;
      for (const tid of i.technician_ids) {
        const cur = map.get(tid) ?? { tid, integracoes: [] as typeof integrations };
        cur.integracoes.push(i);
        map.set(tid, cur);
      }
    }
    return [...map.values()];
  }, [integrations]);

  const drillData = useMemo<{ titulo: string; descricao: string; rows: DrillRow[] }>(() => {
    if (drill === "agendadas") {
      return {
        titulo: "Integrações agendadas",
        descricao: "Aging calculado a partir da data agendada.",
        rows: agendadas.map((i) => ({
          key: i.id,
          titulo: i.nome || "INTEGRAÇÃO",
          cliente: nomeCliente(i.client_id),
          detalhe: i.technician_ids.map(nomeTec).join(", ") || "—",
          agingDays: daysBetween(i.scheduled_at),
          agingBase: i.scheduled_at ? new Date(i.scheduled_at).toLocaleDateString("pt-BR") : "sem data",
        })),
      };
    }
    if (drill === "ressalvas") {
      return {
        titulo: "Integrações com ressalva",
        descricao: "Aging calculado desde a criação da integração.",
        rows: comRessalva.map((i) => ({
          key: i.id,
          titulo: i.nome || "INTEGRAÇÃO",
          cliente: nomeCliente(i.client_id),
          detalhe: i.ressalva_motivo || "Documentos pendentes",
          agingDays: daysBetween(i.completed_at ?? i.criado_em),
          agingBase: new Date(i.completed_at ?? i.criado_em).toLocaleDateString("pt-BR"),
        })),
      };
    }
    if (drill === "tecnicos_ressalva") {
      return {
        titulo: "Funcionários integrados com ressalva",
        descricao: "Aging desde a integração mais antiga com ressalva.",
        rows: tecnicosComRessalva.map(({ tid, integracoes }) => {
          const base = integracoes
            .map((i) => i.completed_at ?? i.criado_em)
            .sort()[0];
          return {
            key: tid,
            titulo: nomeTec(tid),
            cliente: [...new Set(integracoes.map((i) => nomeCliente(i.client_id)))].join(", "),
            detalhe: [...new Set(integracoes.map((i) => i.ressalva_motivo || "Documentos pendentes"))].join(" | "),
            agingDays: daysBetween(base),
            agingBase: new Date(base).toLocaleDateString("pt-BR"),
          };
        }),
      };
    }
    return { titulo: "", descricao: "", rows: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, agendadas, comRessalva, tecnicosComRessalva, clientMap, colabMap]);

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

      <div className="grid gap-3 sm:grid-cols-3 mb-5">
        <Card
          className="cursor-pointer transition-colors hover:border-primary"
          onClick={() => setDrill("agendadas")}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
              <CalendarClock className="h-4 w-4" /> Integrações agendadas
            </div>
            <div className="text-3xl font-semibold mt-1">{agendadas.length}</div>
            <div className="text-[11px] text-muted-foreground">clique para ver a lista</div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer transition-colors hover:border-destructive"
          onClick={() => setDrill("ressalvas")}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
              <AlertTriangle className="h-4 w-4" /> Integrações com ressalva
            </div>
            <div className="text-3xl font-semibold mt-1">{comRessalva.length}</div>
            <div className="text-[11px] text-muted-foreground">clique para ver a lista</div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer transition-colors hover:border-destructive"
          onClick={() => setDrill("tecnicos_ressalva")}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
              <UserCheck className="h-4 w-4" /> Funcionários integrados c/ ressalva
            </div>
            <div className="text-3xl font-semibold mt-1">{tecnicosComRessalva.length}</div>
            <div className="text-[11px] text-muted-foreground">clique para ver a lista</div>
          </CardContent>
        </Card>
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
            <SelectItem value="docs_enviados">Docs enviados</SelectItem>
            <SelectItem value="docs_aceitos">Docs aceitos</SelectItem>
            <SelectItem value="agendada">Agendada</SelectItem>
            <SelectItem value="realizada">Realizada</SelectItem>
            <SelectItem value="bloqueada">Bloqueada</SelectItem>
            <SelectItem value="expirada">Expirada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Integração</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Técnicos</TableHead>
              <TableHead>Status</TableHead>
            <TableHead>Envio</TableHead>
            <TableHead>Aceite</TableHead>
            <TableHead>Agendada</TableHead>
            <TableHead>Realizada</TableHead>
            <TableHead>Válida até</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8">Carregando...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Nenhuma integração.</TableCell></TableRow>
            ) : rows.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="text-xs">
                  <div className="uppercase font-medium">{i.nome || "INTEGRAÇÃO"}</div>
                  {i.ressalva && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="destructive" className="text-[10px] mt-1 mr-1 cursor-help">
                            <AlertTriangle className="h-3 w-3 mr-1" /> RESSALVA
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm whitespace-pre-wrap">
                          {i.ressalva_motivo || "Documentos pendentes"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {i.abrangencia === "compartilhada" ? (
                    <div className="mt-1">
                      <Badge variant="secondary" className="text-[10px]">COMPARTILHADA</Badge>
                      <div className="text-[11px] text-muted-foreground uppercase">
                        {shares
                          .filter((s) => s.integration_id === i.id)
                          .map((s) => clientMap.get(s.client_id)?.nome ?? s.client_id)
                          .join(", ") || "sem empresas abrangidas"}
                      </div>
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">EXCLUSIVA</Badge>
                  )}
                </TableCell>
                <TableCell className="font-medium">{clientMap.get(i.client_id)?.nome ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {i.technician_ids.map((tid) => colabMap.get(tid)?.nome ?? tid).join(", ") || "—"}
                </TableCell>
                <TableCell><Badge variant={statusVariant[i.status] ?? "outline"}>{statusLabel[i.status] ?? i.status}</Badge></TableCell>
                <TableCell className="text-xs">{i.docs_sent_at ? new Date(i.docs_sent_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                <TableCell className="text-xs">{i.docs_accepted_at ? new Date(i.docs_accepted_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                <TableCell className="text-xs">{i.scheduled_at ? new Date(i.scheduled_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                <TableCell className="text-xs">{i.completed_at ? new Date(i.completed_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                <TableCell className="text-xs">{i.integration_valid_until ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openExtend(i.id)}
                      title="Estender para outros clientes"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => navigate(`/rh/integracoes/nova?id=${i.id}`)}
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setToDelete({ id: i.id, nome: clientMap.get(i.client_id)?.nome ?? "esta integração" })}
                      title="Excluir"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir integração?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá a integração de <b>{toDelete?.nome}</b> permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) await del.mutateAsync(toDelete.id);
                setToDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!extendId} onOpenChange={(o) => !o && setExtendId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Estender integração</DialogTitle>
            <DialogDescription>
              A mesma validação e validade valem também para os clientes marcados abaixo.
              Sem nenhum marcado, a integração volta a ser exclusiva de{" "}
              <b>{clientMap.get(extendIntegration?.client_id ?? "")?.nome ?? "—"}</b>.
            </DialogDescription>
          </DialogHeader>

          <Input
            placeholder="Buscar cliente..."
            value={extendSearch}
            onChange={(e) => setExtendSearch(e.target.value)}
          />
          <div className="max-h-72 overflow-auto border rounded-md divide-y">
            {extendCandidates.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Nenhum cliente encontrado.</div>
            ) : extendCandidates.map((c) => (
              <label key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                <Checkbox
                  checked={extendSelected.includes(c.id)}
                  onCheckedChange={(v) =>
                    setExtendSelected((prev) => (v ? [...new Set([...prev, c.id])] : prev.filter((x) => x !== c.id)))
                  }
                />
                <span className="truncate">{c.nome}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{extendSelected.length} cliente(s) abrangido(s).</p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendId(null)}>Cancelar</Button>
            <Button onClick={confirmExtend} disabled={savingExtend}>
              {savingExtend && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar abrangência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}