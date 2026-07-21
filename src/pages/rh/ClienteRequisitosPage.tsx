import { useMemo, useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, Building2, Users, FileCheck, AlertCircle, Download, Loader2, Link2, UserCheck, CheckCircle2, XCircle, PlayCircle } from "lucide-react";
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
  useSaveIntegration,
  computeDocStatus,
} from "@/hooks/rh/useRh";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

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
  const saveIntegration = useSaveIntegration();

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

  // ---------- Funcionários Aptos ----------
  const requiredTechDocTypeIds = useMemo(
    () => techReqs.filter((r) => r.is_required).map((r) => r.document_type_id),
    [techReqs],
  );

  const { data: allTechDocs = [] } = useQuery({
    queryKey: ["rh_colaborador_docs_all_for_client", id, requiredTechDocTypeIds],
    enabled: !!id && requiredTechDocTypeIds.length > 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from("rh_colaborador_docs")
        .select("id, colaborador_id, document_type_id, data_vencimento")
        .in("document_type_id", requiredTechDocTypeIds);
      if (error) throw error;
      return (data ?? []) as Array<{ colaborador_id: string; document_type_id: string; data_vencimento: string | null }>;
    },
  });

  const clientIntegrations = useMemo(
    () => integrations.filter((i) => i.client_id === id),
    [integrations, id],
  );

  const integratedTechIds = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const set = new Set<string>();
    for (const i of clientIntegrations) {
      if (i.status !== "realizada") continue;
      if (i.integration_valid_until) {
        const v = new Date(i.integration_valid_until);
        if (v < today) continue;
      }
      for (const tid of i.technician_ids ?? []) set.add(tid);
    }
    return set;
  }, [clientIntegrations]);

  type AptidaoRow = {
    colaborador: (typeof colabs)[number];
    apto: boolean;
    faltantes: { name: string; reason: "missing" | "expired" | "expiring" }[];
    integrado: boolean;
  };

  const aptidao = useMemo<AptidaoRow[]>(() => {
    return colabs
      .filter((c) => c.ativo !== false)
      .map((c) => {
        // MEI = PJ (CNPJ), CLT = PF (CPF)
        const pack: "MEI" | "CLT" = c.tipo_pessoa === "PJ" ? "MEI" : "CLT";
        const faltantes: AptidaoRow["faltantes"] = [];
        for (const r of techReqs.filter((x) => x.is_required)) {
          const t = typeById.get(r.document_type_id);
          // Se o tipo de documento tem pacote padrão definido e não inclui
          // o pacote deste colaborador, não é obrigatório para ele.
          const pacotes = (t?.pacote_padrao ?? []).filter((p) => p === "MEI" || p === "CLT");
          if (pacotes.length > 0 && !pacotes.includes(pack)) continue;
          const doc = allTechDocs.find(
            (d) => d.colaborador_id === c.id && d.document_type_id === r.document_type_id,
          );
          const st = doc ? computeDocStatus(doc) : "missing";
          if (st === "missing" || st === "expired") {
            faltantes.push({ name: t?.name ?? "Documento", reason: st });
          }
        }
        return {
          colaborador: c,
          apto: faltantes.length === 0,
          faltantes,
          integrado: integratedTechIds.has(c.id),
        };
      })
      .sort((a, b) => {
        // Não integrados aptos primeiro; depois aptos integrados; depois não aptos
        const rank = (r: AptidaoRow) => (r.integrado ? 2 : r.apto ? 0 : 1);
        const d = rank(a) - rank(b);
        return d !== 0 ? d : a.colaborador.nome.localeCompare(b.colaborador.nome);
      });
  }, [colabs, techReqs, allTechDocs, typeById, integratedTechIds]);

  const [integrarOpen, setIntegrarOpen] = useState(false);
  const [integrarTech, setIntegrarTech] = useState<(typeof colabs)[number] | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const [intData, setIntData] = useState(todayIso);
  const [intHoraIni, setIntHoraIni] = useState("08:00");
  const [intHoraFim, setIntHoraFim] = useState("09:00");
  const [integrando, setIntegrando] = useState(false);

  const openIntegrar = (tech: (typeof colabs)[number]) => {
    setIntegrarTech(tech);
    setIntData(todayIso);
    setIntHoraIni("08:00");
    setIntHoraFim("09:00");
    setIntegrarOpen(true);
  };

  const confirmarIntegracao = async () => {
    if (!id || !integrarTech) return;
    if (!intData || !intHoraIni || !intHoraFim) {
      toast.error("Preencha data, hora início e hora fim.");
      return;
    }
    if (intHoraFim <= intHoraIni) {
      toast.error("Hora fim deve ser maior que hora início.");
      return;
    }
    setIntegrando(true);
    try {
      const startIso = new Date(`${intData}T${intHoraIni}:00`).toISOString();
      const endIso = new Date(`${intData}T${intHoraFim}:00`).toISOString();
      await saveIntegration.mutateAsync({
        client_id: id,
        technician_ids: [integrarTech.id],
        status: "realizada",
        send_channel: cliente?.integration_send_channel ?? null,
        scheduled_at: startIso,
        completed_at: endIso,
        completed_by_technician_id: integrarTech.id,
        observacoes: `Integração realizada em ${intData} das ${intHoraIni} às ${intHoraFim}.`,
      });
      toast.success("Integração formalizada");
      setIntegrarOpen(false);
      qc.invalidateQueries({ queryKey: ["rh_integrations"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setIntegrando(false);
    }
  };

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
            <CardContent className="p-0">
              {techReqs.filter((r) => r.is_required).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhum requisito de <b>técnico</b> obrigatório cadastrado. Adicione requisitos na aba "Requisitos" para avaliar aptidão.
                </p>
              ) : aptidao.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum colaborador ativo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Colaborador</TableHead>
                      <TableHead className="w-32">Situação</TableHead>
                      <TableHead>Pendências</TableHead>
                      <TableHead className="w-40 text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aptidao.map((row) => (
                      <TableRow key={row.colaborador.id}>
                        <TableCell>
                          <div className="uppercase font-medium">{row.colaborador.nome}</div>
                          {row.colaborador.cargo && (
                            <div className="text-xs text-muted-foreground">{row.colaborador.cargo}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.integrado ? (
                            <Badge className="bg-blue-500 text-white">JÁ INTEGRADO</Badge>
                          ) : row.apto ? (
                            <Badge className="bg-green-500 text-white gap-1">
                              <CheckCircle2 className="h-3 w-3" /> APTO
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" /> NÃO APTO
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.faltantes.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.faltantes.map((f, i) => (
                                <Badge
                                  key={i}
                                  variant="outline"
                                  className={
                                    f.reason === "expired"
                                      ? "border-orange-500 text-orange-600 text-xs"
                                      : "border-destructive text-destructive text-xs"
                                  }
                                >
                                  {f.name} {f.reason === "expired" ? "(vencido)" : "(faltando)"}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            disabled={!row.apto || row.integrado}
                            onClick={() => openIntegrar(row.colaborador)}
                          >
                            <PlayCircle className="h-4 w-4 mr-1" />
                            {row.integrado ? "Integrado" : "Integrar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
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

      <Dialog open={integrarOpen} onOpenChange={setIntegrarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Formalizar integração</DialogTitle>
            <DialogDescription>
              {integrarTech ? (
                <>
                  Registrar integração de <b className="uppercase">{integrarTech.nome}</b> no cliente{" "}
                  <b className="uppercase">{cliente?.nome}</b>.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Data</Label>
                <Input type="date" value={intData} onChange={(e) => setIntData(e.target.value)} />
              </div>
              <div>
                <Label>Hora início</Label>
                <Input type="time" value={intHoraIni} onChange={(e) => setIntHoraIni(e.target.value)} />
              </div>
              <div>
                <Label>Hora fim</Label>
                <Input type="time" value={intHoraFim} onChange={(e) => setIntHoraFim(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Ao confirmar, a integração será gravada com status <b>REALIZADA</b> e a validade calculada
              automaticamente pela regra do cliente (aniversário da data de realização). O registro aparecerá
              na aba <b>Integrações</b>.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIntegrarOpen(false)} disabled={integrando}>
              Cancelar
            </Button>
            <Button onClick={confirmarIntegracao} disabled={integrando}>
              {integrando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar integração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}