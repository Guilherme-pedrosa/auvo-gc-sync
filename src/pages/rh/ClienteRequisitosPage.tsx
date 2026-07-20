import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, Building2, Users, FileCheck, AlertCircle, Download, Loader2, Link2, UserCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  useRhClientes,
  useDocumentTypes,
  useClientRequirements,
  useAddRequirement,
  useRemoveRequirement,
  useSetRequirementRequired,
  applyRequirementsTemplate,
  useIntegrations,
  useColaboradores,
} from "@/hooks/rh/useRh";
import { useQueryClient } from "@tanstack/react-query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Scope = "COMPANY" | "TECHNICIAN";

export default function ClienteRequisitosPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: clientes = [] } = useRhClientes();
  const { data: types = [] } = useDocumentTypes();
  const { data: reqs = [], isLoading } = useClientRequirements(id);
  const { data: integrations = [] } = useIntegrations();
  const { data: colabs = [] } = useColaboradores();
  const addReq = useAddRequirement();
  const removeReq = useRemoveRequirement();
  const setRequired = useSetRequirementRequired();

  const cliente = useMemo(() => clientes.find((c) => c.id === id), [clientes, id]);

  const [validityMonths, setValidityMonths] = useState<string>("");
  const [sendChannel, setSendChannel] = useState<string>("");
  const [portalUrl, setPortalUrl] = useState<string>("");
  const [portalLogin, setPortalLogin] = useState<string>("");
  const [portalSenha, setPortalSenha] = useState<string>("");
  const [showSenha, setShowSenha] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);

  // Sync local config state whenever cliente loads
  useMemo(() => {
    if (cliente) {
      const months = (cliente as any).integration_validity_months
        ?? (cliente.integration_validity_days != null
          ? Math.max(1, Math.round(Number(cliente.integration_validity_days) / 30))
          : null);
      setValidityMonths(months != null ? String(months) : "");
      setSendChannel(cliente.integration_send_channel ?? "");
      setPortalUrl(cliente.portal_url ?? "");
      setPortalLogin(cliente.portal_login ?? "");
      setPortalSenha(cliente.portal_senha ?? "");
    }
  }, [cliente]);

  const saveIntegrationConfig = async () => {
    if (!id) return;
    const months = validityMonths.trim() === "" ? null : Number(validityMonths);
    if (months !== null && (!Number.isFinite(months) || months <= 0)) {
      toast.error("Prazo deve ser um número maior que zero.");
      return;
    }
    setSavingCfg(true);
    try {
      const { error } = await sb
        .from("rh_clientes")
        .update({
          integration_validity_months: months,
          integration_validity_days: months != null ? months * 30 : null,
          integration_send_channel: sendChannel || null,
          portal_url: sendChannel === "portal" ? (portalUrl || null) : null,
          portal_login: sendChannel === "portal" ? (portalLogin || null) : null,
          portal_senha: sendChannel === "portal" ? (portalSenha || null) : null,
        })
        .eq("id", id);
      if (error) throw error;
      toast.success("Configuração de integração salva");
      qc.invalidateQueries({ queryKey: ["rh_clientes"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingCfg(false);
    }
  };

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
          <h1 className="text-xl font-semibold uppercase">{cliente?.nome ?? "..."}</h1>
          <p className="text-sm text-muted-foreground">Ficha do cliente: dados, requisitos de documentação, integrações e aptidão da equipe.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleTemplate} disabled={templateLoading}>
          {templateLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Aplicar Pacote Padrão
        </Button>
      </div>

      <Tabs defaultValue="resumo" className="w-full">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="requisitos">Requisitos</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="aptos">Funcionários Aptos</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Dados do cliente</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><Label className="text-xs">Nome</Label><div className="uppercase">{cliente?.nome ?? "—"}</div></div>
              <div><Label className="text-xs">CPF/CNPJ</Label><div className="font-mono">{cliente?.cpf_cnpj ?? "—"}</div></div>
              <div><Label className="text-xs">Cidade/UF</Label><div>{[cliente?.cidade, cliente?.uf].filter(Boolean).join(" / ") || "—"}</div></div>
              <div><Label className="text-xs">Nome fantasia</Label><div>{cliente?.nome_fantasia ?? "—"}</div></div>
              <div><Label className="text-xs">E-mail</Label><div>{cliente?.email ?? "—"}</div></div>
              <div><Label className="text-xs">Telefone</Label><div>{cliente?.telefone ?? "—"}</div></div>
              <div className="col-span-full"><Label className="text-xs">Observações</Label><div className="whitespace-pre-wrap">{cliente?.observacoes ?? "—"}</div></div>
            </CardContent>
          </Card>

          <Card>
        <CardHeader>
          <CardTitle className="text-lg">Prazo e canal de integração</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4 items-end">
          <div>
            <Label>Validade da integração (meses)</Label>
            <Input
              type="number"
              min={1}
              value={validityMonths}
              onChange={(e) => setValidityMonths(e.target.value)}
              placeholder="Ex.: 3, 6, 12"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Contado em <b>meses</b> a partir da <b>realização</b> da integração — vence no <b>aniversário</b> da data.
            </p>
          </div>
          <div>
            <Label>Canal de envio</Label>
            <Select value={sendChannel || "none"} onValueChange={(v) => setSendChannel(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— não definido —</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="portal">Portal</SelectItem>
                <SelectItem value="presencial">Presencial</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={saveIntegrationConfig} disabled={savingCfg}>
            {savingCfg && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
          </div>

          {sendChannel === "portal" && (
            <div className="grid md:grid-cols-3 gap-4 pt-2 border-t">
              <div className="md:col-span-3 -mb-2">
                <p className="text-xs font-medium text-muted-foreground">Acesso ao portal</p>
              </div>
              <div>
                <Label>Link do portal</Label>
                <Input
                  type="url"
                  value={portalUrl}
                  onChange={(e) => setPortalUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div>
                <Label>Login</Label>
                <Input
                  value={portalLogin}
                  onChange={(e) => setPortalLogin(e.target.value)}
                  placeholder="usuário"
                  autoComplete="off"
                />
              </div>
              <div>
                <Label>Senha</Label>
                <div className="flex gap-2">
                  <Input
                    type={showSenha ? "text" : "password"}
                    value={portalSenha}
                    onChange={(e) => setPortalSenha(e.target.value)}
                    placeholder="••••••"
                    autoComplete="off"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowSenha((v) => !v)}>
                    {showSenha ? "Ocultar" : "Mostrar"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="requisitos" className="mt-4 space-y-6">
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
        </TabsContent>

        <TabsContent value="integracoes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" /> Integrações do cliente
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Técnicos</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="w-36">Realizada</TableHead>
                    <TableHead className="w-36">Validade</TableHead>
                    <TableHead className="w-32 text-right">Arquivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const clientIntegs = integrations.filter((i) => i.client_id === id);
                    const colabMap = new Map(colabs.map((c) => [c.id, c]));
                    if (clientIntegs.length === 0) {
                      return (
                        <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                          Nenhuma integração registrada para este cliente.
                        </TableCell></TableRow>
                      );
                    }
                    return clientIntegs.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="uppercase text-xs">
                          {(i.technician_ids ?? []).map((tid) => colabMap.get(tid)?.nome ?? tid).join(", ") || "—"}
                        </TableCell>
                        <TableCell><Badge variant="outline">{i.status}</Badge></TableCell>
                        <TableCell>{i.completed_at?.slice(0, 10) ?? "—"}</TableCell>
                        <TableCell>{i.integration_valid_until ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {i.zip_url ? (
                            <a href={i.zip_url} target="_blank" rel="noreferrer" className="text-primary underline text-xs">
                              baixar
                            </a>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    ));
                  })()}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aptos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-muted-foreground" /> Funcionários aptos
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Em breve: cruzamento automático entre requisitos deste cliente e a documentação vigente dos colaboradores para indicar quem está apto a atender.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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