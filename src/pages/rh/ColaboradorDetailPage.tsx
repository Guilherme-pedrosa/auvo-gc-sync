import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Pencil, Trash2, Upload, History as HistoryIcon, Download, FileText, GraduationCap, Link2, AlertCircle } from "lucide-react";
import {
  useColaborador, useColaboradorDocs, useSaveColabDoc, useDeleteColabDoc,
  useDocumentTypes, useIntegrations, useRhClientes, computeDocStatus, type ColabDoc, type DocumentType,
  useColaboradorTreinamentos, useTreinamentoTipos, computeTrainingStatus,
} from "@/hooks/rh/useRh";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const statusColor = (s: string) =>
  s === "expired" ? "destructive" : s === "expiring" ? "secondary" : s === "missing" ? "outline" : "default";

const statusLabel = (s: string) =>
  s === "expired" ? "Vencido" : s === "expiring" ? "Vencendo" : s === "missing" ? "Faltando" : "OK";

export default function ColaboradorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: colab } = useColaborador(id);
  const { data: docs = [] } = useColaboradorDocs(id);
  const { data: types = [] } = useDocumentTypes();
  const { data: integrations = [] } = useIntegrations();
  const { data: clientes = [] } = useRhClientes();
  const { data: colabTreinos = [] } = useColaboradorTreinamentos(id);
  const { data: tTipos = [] } = useTreinamentoTipos();
  const tTipoMap = useMemo(() => new Map(tTipos.map((t) => [t.id, t])), [tTipos]);
  const save = useSaveColabDoc();
  const del = useDeleteColabDoc();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<ColabDoc>>({});
  const [uploading, setUploading] = useState(false);

  const techTypes = useMemo(() => types.filter((t) => t.scope === "TECHNICIAN" && t.ativo), [types]);
  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  // Pacote padrão do colaborador: PJ -> MEI, PF -> CLT
  const packKey: "MEI" | "CLT" = colab?.tipo_pessoa === "PJ" ? "MEI" : "CLT";
  const requiredTypes: DocumentType[] = useMemo(
    () => techTypes.filter((t) => (t.pacote_padrao ?? []).includes(packKey)),
    [techTypes, packKey],
  );
  const requiredTypeIds = useMemo(() => new Set(requiredTypes.map((t) => t.id)), [requiredTypes]);

  // Docs obrigatórios: para cada tipo do pacote, o doc existente ou undefined (faltando)
  const obrigatoriosRows = useMemo(
    () => requiredTypes.map((t) => ({ type: t, doc: docs.find((d) => d.document_type_id === t.id) })),
    [requiredTypes, docs],
  );
  // Docs complementares: qualquer doc que não pertença ao pacote padrão
  const complementares = useMemo(
    () => docs.filter((d) => !requiredTypeIds.has(d.document_type_id)),
    [docs, requiredTypeIds],
  );

  // Integrações do colaborador
  const clienteMap = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const minhasIntegracoes = useMemo(
    () => integrations.filter((i) => id && (i.technician_ids ?? []).includes(id)),
    [integrations, id],
  );

  // Timeline (histórico) — derivada dos dados existentes
  const timeline = useMemo(() => {
    const events: { when: string; kind: "doc" | "integracao"; label: string; detail?: string }[] = [];
    for (const d of docs) {
      const t = typeMap.get(d.document_type_id);
      if (d.data_emissao) {
        events.push({
          when: d.data_emissao,
          kind: "doc",
          label: `Documento emitido: ${t?.name ?? "—"}`,
          detail: d.data_vencimento ? `Válido até ${d.data_vencimento}` : undefined,
        });
      }
    }
    for (const i of minhasIntegracoes) {
      if (i.completed_at) {
        events.push({
          when: i.completed_at.slice(0, 10),
          kind: "integracao",
          label: `Integração realizada — ${clienteMap.get(i.client_id)?.nome ?? "cliente"}`,
          detail: i.integration_valid_until ? `Válida até ${i.integration_valid_until}` : undefined,
        });
      }
    }
    return events.sort((a, b) => (a.when < b.when ? 1 : -1));
  }, [docs, minhasIntegracoes, typeMap, clienteMap]);

  const REQUIRE_DATES_CODES = ["ASO", "FICHA_EPI", "CNH", "CNH_SOCIO"];
  const selectedType = form.document_type_id ? typeMap.get(form.document_type_id) : undefined;
  const requiresDates = !!selectedType && REQUIRE_DATES_CODES.includes(selectedType.code);

  const AUTO_EXPIRY_MONTHS: Record<string, number> = {
    FICHA_EPI: 3,
    NR10: 12, NR12: 12, NR35: 12,
    PCMSO: 12, PGR: 12, LTCAT: 12,
  };
  const addMonths = (iso: string, months: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setMonth(dt.getMonth() + months);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  };
  const handleEmissaoChange = (value: string) => {
    const code = selectedType?.code;
    const months = code ? AUTO_EXPIRY_MONTHS[code] : undefined;
    setForm((f) => ({
      ...f,
      data_emissao: value,
      data_vencimento: value && months ? addMonths(value, months) : f.data_vencimento,
    }));
  };

  const submit = async () => {
    if (!form.document_type_id || !id) return;
    if (requiresDates && (!form.data_emissao || !form.data_vencimento)) {
      toast.error(`${selectedType?.name}: data de emissão e vencimento são obrigatórias.`);
      return;
    }
    await save.mutateAsync({ ...form, colaborador_id: id });
    setOpen(false); setForm({});
  };

  const openArquivo = async (url: string) => {
    if (!url) return;
    if (/^https?:\/\//i.test(url)) { window.open(url, "_blank"); return; }
    const { data, error } = await supabase.storage.from("rh-documentos").createSignedUrl(url, 60 * 60);
    if (error || !data?.signedUrl) { toast.error("Falha ao abrir arquivo"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !id) return;
    setUploading(true);
    try {
      const path = `colaborador/${id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await supabase.storage.from("rh-documentos").upload(path, file, { upsert: false });
      if (error) throw error;
      setForm((f) => ({ ...f, arquivo_url: path, arquivo_nome: f.arquivo_nome || file.name }));
      toast.success("Arquivo enviado");
    } catch (e) {
      toast.error("Falha no upload: " + (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const openAddForType = (typeId?: string) => {
    setForm(typeId ? { document_type_id: typeId } : {});
    setOpen(true);
  };

  const renderDocActions = (d?: ColabDoc, typeId?: string) => (
    <div className="flex gap-1 justify-end">
      {d?.arquivo_url && (
        <Button size="sm" variant="ghost" onClick={() => openArquivo(d.arquivo_url!)} title="Abrir arquivo">
          <Download className="h-3.5 w-3.5" />
        </Button>
      )}
      {d ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => { setForm(d); setOpen(true); }} title="Editar">
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => id && del.mutate({ id: d.id, colaborador_id: id })} title="Excluir">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => openAddForType(typeId)}>
          <Upload className="h-3.5 w-3.5 mr-1" /> Upload
        </Button>
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rh/colaboradores")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold uppercase">{colab?.nome ?? "..."}</h1>
            <div className="text-sm text-muted-foreground grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <div><span className="text-xs">Tipo:</span> {colab?.tipo_pessoa}</div>
              <div><span className="text-xs">CPF/CNPJ:</span> {colab?.cpf_cnpj ?? "—"}</div>
              <div><span className="text-xs">Cargo:</span> {colab?.cargo ?? "—"}</div>
              <div><span className="text-xs">Função:</span> {colab?.funcao ?? "—"}</div>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            Pacote padrão: {packKey}
          </Badge>
        </div>
      </Card>

      <Tabs defaultValue="resumo" className="w-full">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="treinamentos">Treinamentos</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Dados cadastrais</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><Label className="text-xs">Nome</Label><div className="uppercase">{colab?.nome ?? "—"}</div></div>
              <div><Label className="text-xs">Tipo</Label><div>{colab?.tipo_pessoa ?? "—"}</div></div>
              <div><Label className="text-xs">CPF/CNPJ</Label><div className="font-mono">{colab?.cpf_cnpj ?? "—"}</div></div>
              <div><Label className="text-xs">Cargo</Label><div>{colab?.cargo ?? "—"}</div></div>
              <div><Label className="text-xs">Função</Label><div>{colab?.funcao ?? "—"}</div></div>
              <div><Label className="text-xs">Departamento</Label><div>{colab?.departamento ?? "—"}</div></div>
              <div><Label className="text-xs">Email</Label><div>{colab?.email ?? "—"}</div></div>
              <div><Label className="text-xs">Telefone</Label><div>{colab?.telefone ?? "—"}</div></div>
              <div><Label className="text-xs">Auvo User ID</Label><div className="font-mono text-xs">{colab?.auvo_user_id ?? "—"}</div></div>
              <div className="col-span-full"><Label className="text-xs">Observações</Label><div className="whitespace-pre-wrap">{colab?.observacoes ?? "—"}</div></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documentos" className="mt-4 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Documentos obrigatórios <Badge variant="outline" className="ml-1 text-[10px]">{packKey}</Badge>
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {obrigatoriosRows.filter((r) => r.doc).length}/{obrigatoriosRows.length} preenchidos
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-32">Emissão</TableHead>
                    <TableHead className="w-32">Validade</TableHead>
                    <TableHead className="w-40 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {obrigatoriosRows.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                      Nenhum documento obrigatório configurado para o pacote {packKey}. Ajuste em Configurações → Pacotes Padrão.
                    </TableCell></TableRow>
                  ) : obrigatoriosRows.map(({ type, doc }) => {
                    const st = computeDocStatus(doc);
                    return (
                      <TableRow key={type.id}>
                        <TableCell className="font-medium">{type.name}</TableCell>
                        <TableCell><Badge variant={statusColor(st) as never}>{statusLabel(st)}</Badge></TableCell>
                        <TableCell>{doc?.data_emissao ?? "—"}</TableCell>
                        <TableCell>{doc?.data_vencimento ?? "—"}</TableCell>
                        <TableCell>{renderDocActions(doc, type.id)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Documentos complementares
              </CardTitle>
              <Button size="sm" onClick={() => openAddForType()}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar Documento
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-32">Emissão</TableHead>
                    <TableHead className="w-32">Validade</TableHead>
                    <TableHead className="w-40 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {complementares.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                      Nenhum documento complementar. Use "Adicionar Documento" para incluir certificados, advertências, contratos ou outros.
                    </TableCell></TableRow>
                  ) : complementares.map((d) => {
                    const st = computeDocStatus(d);
                    return (
                      <TableRow key={d.id}>
                        <TableCell>{typeMap.get(d.document_type_id)?.name ?? "—"}</TableCell>
                        <TableCell><Badge variant={statusColor(st) as never}>{statusLabel(st)}</Badge></TableCell>
                        <TableCell>{d.data_emissao ?? "—"}</TableCell>
                        <TableCell>{d.data_vencimento ?? "—"}</TableCell>
                        <TableCell>{renderDocActions(d)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="treinamentos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                Treinamentos do colaborador
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Os treinamentos são cadastrados no módulo <b>RH → Treinamentos</b> e vinculados automaticamente ao selecionar participantes.
              Esta lista exibirá treinamento, data, validade e download de certificado / lista de presença quando o módulo estiver ativo.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integracoes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                Integrações realizadas
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36">Realizada em</TableHead>
                    <TableHead className="w-36">Validade</TableHead>
                    <TableHead className="w-32 text-right">Arquivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {minhasIntegracoes.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                      Nenhuma integração vinculada a este colaborador.
                    </TableCell></TableRow>
                  ) : minhasIntegracoes.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium uppercase">{clienteMap.get(i.client_id)?.nome ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{i.status}</Badge></TableCell>
                      <TableCell>{i.completed_at?.slice(0, 10) ?? "—"}</TableCell>
                      <TableCell>{i.integration_valid_until ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {i.zip_url ? (
                          <Button size="sm" variant="ghost" onClick={() => openArquivo(i.zip_url!)}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <HistoryIcon className="h-4 w-4 text-muted-foreground" />
                Linha do tempo do prontuário
              </CardTitle>
            </CardHeader>
            <CardContent>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Sem movimentações registradas.</p>
              ) : (
                <ol className="relative border-l border-border pl-4 space-y-4">
                  {timeline.map((ev, idx) => (
                    <li key={idx} className="ml-2">
                      <span className={`absolute -left-1.5 mt-1 h-3 w-3 rounded-full ${ev.kind === "doc" ? "bg-primary" : "bg-emerald-500"}`} />
                      <div className="text-xs text-muted-foreground">{ev.when}</div>
                      <div className="text-sm font-medium">{ev.label}</div>
                      {ev.detail && <div className="text-xs text-muted-foreground">{ev.detail}</div>}
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-[11px] text-muted-foreground mt-4 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> Timeline derivada dos documentos e integrações existentes.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} documento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={form.document_type_id} onValueChange={(v) => setForm({ ...form, document_type_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {techTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Emissão {requiresDates && <span className="text-destructive">*</span>}</Label>
                <Input type="date" required={requiresDates} value={form.data_emissao ?? ""} onChange={(e) => handleEmissaoChange(e.target.value)} />
              </div>
              <div>
                <Label>Vencimento {requiresDates && <span className="text-destructive">*</span>}</Label>
                <Input type="date" required={requiresDates} value={form.data_vencimento ?? ""} onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })} />
              </div>
            </div>
            {requiresDates && (
              <p className="text-xs text-destructive">
                {selectedType?.name} exige data de emissão e vencimento.
              </p>
            )}
            <div>
              <Label>Anexo</Label>
              <Input type="file" onChange={(e) => handleUpload(e.target.files?.[0] ?? null)} disabled={uploading} />
              {form.arquivo_url && (
                <p className="text-xs text-muted-foreground mt-1">
                  {uploading ? "Enviando..." : `Arquivo: ${form.arquivo_nome ?? form.arquivo_url}`}
                </p>
              )}
            </div>
            <div><Label>Nome do arquivo</Label><Input className="uppercase" value={form.arquivo_nome ?? ""} onChange={(e) => setForm({ ...form, arquivo_nome: e.target.value.toUpperCase() })} placeholder="Opcional" /></div>
            <div><Label className="text-xs text-muted-foreground">Ou URL externa</Label><Input value={/^https?:\/\//i.test(form.arquivo_url ?? "") ? (form.arquivo_url ?? "") : ""} onChange={(e) => setForm({ ...form, arquivo_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>Observações</Label><Textarea className="uppercase" value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value.toUpperCase() })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={save.isPending || (requiresDates && (!form.data_emissao || !form.data_vencimento))}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}