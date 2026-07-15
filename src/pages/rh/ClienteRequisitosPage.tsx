import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, Building2, Users, FileCheck, AlertCircle, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useRhClientes,
  useDocumentTypes,
  useClientRequirements,
  useAddRequirement,
  useRemoveRequirement,
  useSetRequirementRequired,
  applyRequirementsTemplate,
} from "@/hooks/rh/useRh";
import { useQueryClient } from "@tanstack/react-query";

type Scope = "COMPANY" | "TECHNICIAN";

export default function ClienteRequisitosPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: clientes = [] } = useRhClientes();
  const { data: types = [] } = useDocumentTypes();
  const { data: reqs = [], isLoading } = useClientRequirements(id);
  const addReq = useAddRequirement();
  const removeReq = useRemoveRequirement();
  const setRequired = useSetRequirementRequired();

  const cliente = useMemo(() => clientes.find((c) => c.id === id), [clientes, id]);

  const companyReqs = useMemo(() => reqs.filter((r) => r.required_for === "COMPANY"), [reqs]);
  const techReqs = useMemo(() => reqs.filter((r) => r.required_for === "TECHNICIAN"), [reqs]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const availableCompany = useMemo(
    () => types.filter((t) => t.ativo && t.scope === "COMPANY" && !companyReqs.some((r) => r.document_type_id === t.id)),
    [types, companyReqs],
  );
  const availableTech = useMemo(
    () => types.filter((t) => t.ativo && t.scope === "TECHNICIAN" && !techReqs.some((r) => r.document_type_id === t.id)),
    [types, techReqs],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogScope, setDialogScope] = useState<Scope>("COMPANY");
  const [dialogTypeId, setDialogTypeId] = useState("");
  const [templateLoading, setTemplateLoading] = useState(false);

  const openAdd = (scope: Scope) => {
    setDialogScope(scope);
    setDialogTypeId("");
    setDialogOpen(true);
  };

  const handleAdd = async () => {
    if (!id || !dialogTypeId) {
      toast.error("Selecione um tipo de documento");
      return;
    }
    await addReq.mutateAsync({ client_id: id, document_type_id: dialogTypeId, required_for: dialogScope, is_required: true });
    toast.success("Requisito adicionado");
    setDialogOpen(false);
  };

  const handleRemove = async (rid: string) => {
    if (!id) return;
    if (!confirm("Remover este requisito?")) return;
    await removeReq.mutateAsync({ id: rid, client_id: id });
    toast.success("Requisito removido");
  };

  const handleToggleRequired = (rid: string, current: boolean) => {
    if (!id) return;
    setRequired.mutate({ id: rid, is_required: !current, client_id: id });
  };

  const handleTemplate = async () => {
    if (!id) return;
    setTemplateLoading(true);
    try {
      const n = await applyRequirementsTemplate(id, types, reqs);
      if (n === 0) toast.info("Nenhum requisito novo do template");
      else toast.success(`${n} requisito(s) adicionado(s) do template`);
      qc.invalidateQueries({ queryKey: ["rh_client_requirements", id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTemplateLoading(false);
    }
  };

  const availableForDialog = dialogScope === "COMPANY" ? availableCompany : availableTech;
  const totalRequired = companyReqs.filter((r) => r.is_required).length + techReqs.filter((r) => r.is_required).length;

  const renderTable = (rows: typeof reqs, empty: string) => (
    <>
      {isLoading ? (
        <p className="text-muted-foreground text-center py-4">Carregando...</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <FileCheck className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>{empty}</p>
          <p className="text-sm">Clique em "Adicionar" para configurar</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Documento</TableHead>
              <TableHead className="text-center w-28">Obrigatório</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const t = typeById.get(r.document_type_id);
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{t?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {t?.requires_expiry ? "Com vencimento" : "Sem vencimento"}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch checked={r.is_required} onCheckedChange={() => handleToggleRequired(r.id, r.is_required)} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => handleRemove(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rh/clientes")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">{cliente?.nome ?? "..."}</h1>
          <p className="text-sm text-muted-foreground">Configure quais documentos são exigidos por este cliente.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleTemplate} disabled={templateLoading}>
          {templateLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Aplicar Pacote Padrão
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Documentos da Empresa
            </CardTitle>
            <Button size="sm" onClick={() => openAdd("COMPANY")}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </CardHeader>
          <CardContent>{renderTable(companyReqs, "Nenhum requisito cadastrado")}</CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" /> Documentos do Técnico
            </CardTitle>
            <Button size="sm" onClick={() => openAdd("TECHNICIAN")}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </CardHeader>
          <CardContent>{renderTable(techReqs, "Nenhum requisito cadastrado")}</CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-6 justify-center text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span>{companyReqs.length} documento(s) da empresa</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span>{techReqs.length} documento(s) do técnico</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <span>{totalRequired} obrigatório(s)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Adicionar Requisito — {dialogScope === "COMPANY" ? "Empresa" : "Técnico"}
            </DialogTitle>
            <DialogDescription>Selecione o tipo de documento que será exigido.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tipo de Documento</Label>
              <Select value={dialogTypeId} onValueChange={setDialogTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {availableForDialog.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.requires_expiry && <span className="text-muted-foreground ml-2">(com vencimento)</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableForDialog.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Todos os tipos disponíveis já foram adicionados ou não há tipos cadastrados para este escopo.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={!dialogTypeId || addReq.isPending}>
              {addReq.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}