import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  ArrowLeft, ShieldCheck, ShieldX, Download, Building2, Users,
  CheckCircle, Clock, FileX, FileCheck, AlertCircle, Loader2, Save,
} from "lucide-react";
import JSZip from "jszip";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  useRhClientes, useColaboradores, useSaveIntegration, useIntegrations,
  useDocumentTypes, useCompanyDocs, useClientRequirements,
  computeDocStatus,
} from "@/hooks/rh/useRh";
import { supabase } from "@/integrations/supabase/client";

type Scope = "both" | "company" | "technician";
type DocState = "ok" | "expiring" | "expired" | "missing";
type BlockReason = { scope: "EMPRESA" | "TÉCNICO"; entity_name?: string; doc_type: string; reason: string };

interface DocRow {
  doc_type_id: string;
  doc_type_code: string;
  doc_type_name: string;
  state: DocState;
  arquivo_url: string | null;
  arquivo_nome: string | null;
  data_vencimento: string | null;
  is_required: boolean;
}
interface TechBlock {
  technician_id: string;
  technician_name: string;
  docs: DocRow[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

async function resolveFile(url: string): Promise<Blob | null> {
  try {
    if (/^https?:\/\//i.test(url)) {
      const r = await fetch(url);
      return await r.blob();
    }
    const { data, error } = await supabase.storage.from("rh-documentos").createSignedUrl(url, 60 * 60);
    if (error || !data?.signedUrl) return null;
    const r = await fetch(data.signedUrl);
    return await r.blob();
  } catch {
    return null;
  }
}

function stateIcon(s: DocState) {
  if (s === "ok") return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (s === "expiring") return <Clock className="h-4 w-4 text-amber-500" />;
  if (s === "expired") return <Clock className="h-4 w-4 text-orange-500" />;
  return <FileX className="h-4 w-4 text-destructive" />;
}
function stateBadge(s: DocState) {
  if (s === "ok") return <Badge className="bg-green-500 text-white">OK</Badge>;
  if (s === "expiring") return <Badge variant="outline" className="border-amber-500 text-amber-600">VENCE EM BREVE</Badge>;
  if (s === "expired") return <Badge variant="outline" className="border-orange-500 text-orange-600">VENCIDO</Badge>;
  return <Badge variant="destructive">FALTANDO</Badge>;
}

export default function NovaIntegracaoPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editingId = searchParams.get("id");
  const { data: clientes = [] } = useRhClientes();
  const { data: colabs = [] } = useColaboradores();
  const { data: docTypes = [] } = useDocumentTypes();
  const { data: companyDocs = [] } = useCompanyDocs();
  const { data: integrations = [] } = useIntegrations();
  const save = useSaveIntegration();

  const [clientId, setClientId] = useState<string>("");
  const [scope, setScope] = useState<Scope>("both");
  const [techIds, setTechIds] = useState<string[]>([]);
  const [status, setStatus] = useState<"INITIAL" | "AUTHORIZED" | "BLOCKED">("INITIAL");
  const [reasons, setReasons] = useState<BlockReason[]>([]);
  const [companyRows, setCompanyRows] = useState<DocRow[]>([]);
  const [techBlocks, setTechBlocks] = useState<TechBlock[]>([]);
  const [earliestExpiry, setEarliestExpiry] = useState<string | null>(null);
  const [validade, setValidade] = useState<string>("");
  const [validating, setValidating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  // Prefill when editing
  useEffect(() => {
    if (!editingId || prefilled) return;
    const rec = integrations.find((i) => i.id === editingId);
    if (!rec) return;
    setClientId(rec.client_id);
    setTechIds(rec.technician_ids || []);
    setScope((rec.technician_ids?.length ?? 0) > 0 ? "both" : "company");
    setValidade(rec.earliest_expiry_date ?? "");
    setPrefilled(true);
  }, [editingId, integrations, prefilled]);

  const { data: reqs = [], isLoading: loadingReqs } = useClientRequirements(clientId || undefined);

  const clienteOptions = useMemo(
    () => clientes.filter((c) => c.ativo !== false).map((c) => ({ value: c.id, label: c.nome })),
    [clientes],
  );
  const techOptions = useMemo(
    () => colabs.filter((c) => c.ativo !== false).map((c) => ({ value: c.id, label: c.nome })),
    [colabs],
  );

  const typeMap = useMemo(() => new Map(docTypes.map((t) => [t.id, t])), [docTypes]);
  const companyReqs = useMemo(() => reqs.filter((r) => r.required_for === "COMPANY"), [reqs]);
  const technicianReqs = useMemo(() => reqs.filter((r) => r.required_for === "TECHNICIAN"), [reqs]);
  const hasRequirements = reqs.length > 0;
  const needsTech = scope !== "company";
  const canValidate = !!clientId && hasRequirements && (!needsTech || techIds.length > 0);

  const resetClient = (id: string) => {
    setClientId(id);
    setTechIds([]);
    setScope("both");
    setStatus("INITIAL");
    setReasons([]);
    setCompanyRows([]);
    setTechBlocks([]);
    setEarliestExpiry(null);
    setValidade("");
  };

  const validate = async () => {
    if (!canValidate) return;
    setValidating(true);
    try {
      const problems: BlockReason[] = [];
      let minExp: Date | null = null;
      const trackExp = (v: string | null | undefined, st: DocState) => {
        if (!v || st !== "ok") return;
        const d = new Date(v);
        if (!minExp || d < minExp) minExp = d;
      };

      // Empresa
      const includeCompany = scope !== "technician";
      const cRows: DocRow[] = includeCompany ? companyReqs.map((r) => {
        const t = typeMap.get(r.document_type_id);
        const doc = companyDocs.find((d) => d.document_type_id === r.document_type_id);
        const st: DocState = doc ? computeDocStatus(doc) : "missing";
        if (r.is_required && (st === "missing" || st === "expired")) {
          problems.push({ scope: "EMPRESA", doc_type: t?.name || "Documento", reason: st === "missing" ? "Não anexado" : "Vencido" });
        }
        trackExp(doc?.data_vencimento ?? null, st);
        return {
          doc_type_id: r.document_type_id,
          doc_type_code: t?.code || "",
          doc_type_name: t?.name || "Documento",
          state: st,
          arquivo_url: doc?.arquivo_url ?? null,
          arquivo_nome: doc?.arquivo_nome ?? null,
          data_vencimento: doc?.data_vencimento ?? null,
          is_required: r.is_required,
        };
      }) : [];

      // Técnicos
      const includeTech = scope !== "company";
      let tBlocks: TechBlock[] = [];
      if (includeTech && techIds.length > 0) {
        const { data: tdocs, error } = await sb
          .from("rh_colaborador_docs")
          .select("*")
          .in("colaborador_id", techIds);
        if (error) throw error;
        tBlocks = techIds.map((tid) => {
          const tech = colabs.find((c) => c.id === tid);
          const name = tech?.nome || tid;
          const rows: DocRow[] = technicianReqs.map((r) => {
            const t = typeMap.get(r.document_type_id);
            const doc = (tdocs as Array<{ colaborador_id: string; document_type_id: string; data_vencimento: string | null; arquivo_url: string | null; arquivo_nome: string | null }>).find(
              (d) => d.colaborador_id === tid && d.document_type_id === r.document_type_id,
            );
            const st: DocState = doc ? computeDocStatus(doc) : "missing";
            if (r.is_required && (st === "missing" || st === "expired")) {
              problems.push({ scope: "TÉCNICO", entity_name: name, doc_type: t?.name || "Documento", reason: st === "missing" ? "Não anexado" : "Vencido" });
            }
            trackExp(doc?.data_vencimento ?? null, st);
            return {
              doc_type_id: r.document_type_id,
              doc_type_code: t?.code || "",
              doc_type_name: t?.name || "Documento",
              state: st,
              arquivo_url: doc?.arquivo_url ?? null,
              arquivo_nome: doc?.arquivo_nome ?? null,
              data_vencimento: doc?.data_vencimento ?? null,
              is_required: r.is_required,
            };
          });
          return { technician_id: tid, technician_name: name, docs: rows };
        });
      }

      setCompanyRows(cRows);
      setTechBlocks(tBlocks);
      setReasons(problems);
      setEarliestExpiry(minExp ? format(minExp, "yyyy-MM-dd") : null);
      if (!validade && minExp) setValidade(format(minExp, "yyyy-MM-dd"));
      setStatus(problems.length > 0 ? "BLOCKED" : "AUTHORIZED");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setValidating(false);
    }
  };

  const generateZip = async () => {
    if (status !== "AUTHORIZED") return;
    if (!validade) {
      toast.error("Informe a validade da integração antes de gerar o kit.");
      return;
    }
    setGenerating(true);
    try {
      const zip = new JSZip();
      const empresa = zip.folder("EMPRESA");
      const tecnicos = zip.folder("TECNICOS");
      const manifest = {
        generated_at: new Date().toISOString(),
        client_id: clientId,
        technician_ids: techIds,
        scope,
        company_docs: [] as string[],
        technician_docs: {} as Record<string, string[]>,
      };

      for (const d of companyRows) {
        if (d.state !== "ok" || !d.arquivo_url) continue;
        const blob = await resolveFile(d.arquivo_url);
        if (!blob) continue;
        const ext = d.arquivo_nome?.split(".").pop() || "pdf";
        const name = d.arquivo_nome || `${d.doc_type_code || d.doc_type_name}.${ext}`;
        empresa?.file(name, blob);
        manifest.company_docs.push(name);
      }

      for (const t of techBlocks) {
        const folder = tecnicos?.folder(t.technician_name.replace(/[^\p{L}\p{N} ]+/gu, "").replace(/\s+/g, "_"));
        const names: string[] = [];
        for (const d of t.docs) {
          if (d.state !== "ok" || !d.arquivo_url) continue;
          const blob = await resolveFile(d.arquivo_url);
          if (!blob) continue;
          const ext = d.arquivo_nome?.split(".").pop() || "pdf";
          const name = d.arquivo_nome || `${d.doc_type_code || d.doc_type_name}.${ext}`;
          folder?.file(name, blob);
          names.push(name);
        }
        manifest.technician_docs[t.technician_id] = names;
      }

      zip.file("manifest.json", JSON.stringify(manifest, null, 2));

      const cliente = clientes.find((c) => c.id === clientId);
      const fileName = `Kit_${(cliente?.nome || "Cliente").replace(/[^a-zA-Z0-9]/g, "_")}_${format(new Date(), "yyyy-MM-dd")}.zip`;
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);

      // Persist integration record
      await save.mutateAsync({
        ...(editingId ? { id: editingId } : {}),
        client_id: clientId,
        technician_ids: techIds,
        status: "authorized",
        validated_at: new Date().toISOString(),
        earliest_expiry_date: validade,
        blocked_reasons: [],
        zip_file_name: fileName,
      });

      toast.success("Kit ZIP gerado!");
    } catch (e) {
      toast.error("Erro ao gerar: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rh/integracoes")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">Nova Integração</h1>
        <p className="text-sm text-muted-foreground">Gere o kit de documentação (ZIP) para acesso do cliente.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Seleção */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-lg">Seleção</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Cliente</Label>
              <SearchableSelect
                options={clienteOptions}
                value={clientId}
                onValueChange={resetClient}
                placeholder="Buscar cliente..."
                searchPlaceholder="Digite o nome..."
                className="w-full"
              />
            </div>

            {clientId && !loadingReqs && (
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium mb-1">Requisitos do cliente:</p>
                <p className="text-muted-foreground">• {companyReqs.length} documento(s) da empresa</p>
                <p className="text-muted-foreground">• {technicianReqs.length} documento(s) do técnico</p>
                {!hasRequirements && (
                  <p className="text-amber-600 mt-2 text-xs">
                    ⚠️ Nenhum requisito cadastrado. Configure em "Requisitos" do cliente.
                  </p>
                )}
              </div>
            )}

            {clientId && hasRequirements && (
              <>
                <div>
                  <Label className="mb-2 block">Tipo de Documentação</Label>
                  <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="both" id="s-both" />
                      <Label htmlFor="s-both" className="font-normal cursor-pointer">Empresa + Técnico(s)</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="company" id="s-comp" />
                      <Label htmlFor="s-comp" className="font-normal cursor-pointer">Apenas Empresa</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="technician" id="s-tech" />
                      <Label htmlFor="s-tech" className="font-normal cursor-pointer">Apenas Técnico(s)</Label>
                    </div>
                  </RadioGroup>
                </div>

                {needsTech && (
                  <div>
                    <Label>Técnicos</Label>
                    <SearchableSelect
                      multiple
                      options={techOptions}
                      value={techIds}
                      onValueChange={setTechIds}
                      placeholder="Selecione técnicos..."
                      searchPlaceholder="Buscar técnico..."
                      className="w-full"
                    />
                  </div>
                )}

                <div>
                  <Label htmlFor="validade">
                    Validade da integração <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="validade"
                    type="date"
                    value={validade}
                    onChange={(e) => setValidade(e.target.value)}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Obrigatório. Sugerido: menor vencimento dos documentos.
                  </p>
                </div>
              </>
            )}

            <Button className="w-full" onClick={validate} disabled={!canValidate || validating}>
              {validating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
              Validar Documentação
            </Button>
          </CardContent>
        </Card>

        {/* Resultado */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {status === "AUTHORIZED" ? (
                <>
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                  <span className="text-green-600">AUTORIZADO</span>
                  {earliestExpiry && (
                    <span className="text-muted-foreground text-sm font-normal ml-2">
                      (válido até {format(new Date(earliestExpiry), "dd/MM/yyyy")})
                    </span>
                  )}
                </>
              ) : status === "BLOCKED" ? (
                <>
                  <ShieldX className="h-5 w-5 text-destructive" />
                  <span className="text-destructive">BLOQUEADO</span>
                  <span className="text-muted-foreground text-sm font-normal ml-2">
                    {reasons.length} pendência(s)
                  </span>
                </>
              ) : (
                "Resultado da Validação"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {status === "INITIAL" ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Selecione cliente {needsTech ? "e técnicos" : ""} e clique em "Validar Documentação"</p>
              </div>
            ) : (
              <div className="space-y-6">
                {reasons.length > 0 && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-destructive font-medium mb-3">
                      <AlertCircle className="h-4 w-4" /> Documentos pendentes
                    </div>
                    <ul className="space-y-1 text-sm">
                      {reasons.map((r, i) => (
                        <li key={i} className="text-muted-foreground">
                          • {r.scope}{r.entity_name ? `: ${r.entity_name}` : ""} — {r.doc_type} — {r.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {companyRows.length > 0 && (
                  <div>
                    <h4 className="font-semibold flex items-center gap-2 mb-3">
                      <Building2 className="h-4 w-4" /> Documentos da Empresa
                    </h4>
                    <div className="space-y-2">
                      {companyRows.map((d) => (
                        <div key={d.doc_type_id} className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-3">
                            {stateIcon(d.state)}
                            <span className="font-medium">{d.doc_type_name}</span>
                            {!d.is_required && <Badge variant="outline" className="text-xs">opcional</Badge>}
                          </div>
                          <div className="flex items-center gap-3">
                            {d.data_vencimento && (
                              <span className="text-xs text-muted-foreground">
                                vence em {format(new Date(d.data_vencimento), "MM/yyyy")}
                              </span>
                            )}
                            {stateBadge(d.state)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {techBlocks.length > 0 && (
                  <div>
                    <h4 className="font-semibold flex items-center gap-2 mb-3">
                      <Users className="h-4 w-4" /> Documentos dos Técnicos
                    </h4>
                    <div className="space-y-4">
                      {techBlocks.map((t) => (
                        <div key={t.technician_id} className="border rounded-lg p-4">
                          <h5 className="font-medium mb-3">{t.technician_name}</h5>
                          <div className="space-y-2">
                            {t.docs.map((d) => (
                              <div key={d.doc_type_id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                                <div className="flex items-center gap-3">
                                  {stateIcon(d.state)}
                                  <span className="text-sm">{d.doc_type_name}</span>
                                  {!d.is_required && <Badge variant="outline" className="text-xs">opcional</Badge>}
                                </div>
                                <div className="flex items-center gap-3">
                                  {d.data_vencimento && (
                                    <span className="text-xs text-muted-foreground">
                                      vence em {format(new Date(d.data_vencimento), "MM/yyyy")}
                                    </span>
                                  )}
                                  {stateBadge(d.state)}
                                </div>
                              </div>
                            ))}
                            {t.docs.length === 0 && (
                              <p className="text-xs text-muted-foreground">Nenhum requisito de técnico configurado.</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-4 border-t">
                  <Button
                    onClick={generateZip}
                    disabled={status !== "AUTHORIZED" || generating}
                    className="flex-1"
                  >
                    {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                    Gerar ZIP
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}