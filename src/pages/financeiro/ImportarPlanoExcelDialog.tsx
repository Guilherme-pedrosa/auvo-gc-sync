import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Upload, AlertTriangle, CheckCircle2, XCircle, FileSpreadsheet } from "lucide-react";

type Grupo = { id: string; nome: string };

type SheetInfo = { name: string; header_ok: boolean; count: number };

type Conflito = { campo: string; atual: any; excel: any };

type PreviewRow = {
  linha: number;
  excel_id: string | null;
  excel_nome: string;
  categoria: string;
  criticidade: string;
  periodicidade: string;
  ht_total: number;
  mes_inicio_ciclo: number;
  meses_planejados: number[];
  erro: string | null;
  auvo_match: {
    id: string;
    identificador: string;
    nome: string;
    cliente: string;
    status: string;
    tipo_id_atual: string | null;
    tipo_nome_atual: string | null;
  } | null;
  plano_atual: any | null;
  conflitos: Conflito[];
};

type Orfao = { id: string; identificador: string; nome: string; cliente: string };

type PreviewResp = {
  ok: boolean;
  sheet: string;
  ano_referencia: number;
  stats: {
    total_excel: number; casados: number; nao_encontrados: number;
    sem_id: number; inativos: number; com_conflito: number; orfaos_auvo: number;
  };
  rows: PreviewRow[];
  orfaos_auvo: Orfao[];
  error?: string;
};

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function ImportarPlanoExcelDialog({
  open, onOpenChange, grupos, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grupos: Grupo[];
  onImported: () => void;
}) {
  const [grupoId, setGrupoId] = useState<string>("");
  const [ano, setAno] = useState<number>(new Date().getFullYear());
  const [file, setFile] = useState<File | null>(null);
  const [b64, setB64] = useState<string>("");
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [sheet, setSheet] = useState<string>("");
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<PreviewResp | null>(null);

  // per-row decisions
  const [applyTipo, setApplyTipo] = useState<Record<number, boolean>>({});
  const [overwriteConflict, setOverwriteConflict] = useState<Record<number, boolean>>({});
  const [skip, setSkip] = useState<Record<number, boolean>>({});

  const reset = () => {
    setFile(null); setB64(""); setSheets([]); setSheet(""); setPreview(null);
    setApplyTipo({}); setOverwriteConflict({}); setSkip({});
  };

  const handleFile = async (f: File | null) => {
    if (!f) { reset(); return; }
    setFile(f); setSheets([]); setSheet(""); setPreview(null);
    setLoadingSheets(true);
    try {
      const b = await fileToBase64(f);
      setB64(b);
      const { data, error } = await supabase.functions.invoke("plano-preventivo-import", {
        body: { mode: "list_sheets", xlsx_base64: b },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao ler abas");
      setSheets(data.sheets || []);
    } catch (e: any) {
      toast.error(`Erro lendo Excel: ${e.message}`);
    } finally {
      setLoadingSheets(false);
    }
  };

  const runPreview = async () => {
    if (!grupoId) { toast.error("Selecione o grupo"); return; }
    if (!sheet) { toast.error("Selecione a aba (casa)"); return; }
    setPreviewing(true);
    try {
      const { data, error } = await supabase.functions.invoke("plano-preventivo-import", {
        body: { mode: "preview", grupo_id: grupoId, ano_referencia: ano, sheet, xlsx_base64: b64 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha no preview");
      setPreview(data as PreviewResp);
      // default: aplicar tipo onde o equipamento não tem tipo definido
      const at: Record<number, boolean> = {};
      for (const r of (data as PreviewResp).rows) {
        at[r.linha] = !r.auvo_match?.tipo_nome_atual; // sugere aplicar onde está vazio
      }
      setApplyTipo(at);
      setOverwriteConflict({});
      setSkip({});
    } catch (e: any) {
      toast.error(`Erro no preview: ${e.message}`);
    } finally {
      setPreviewing(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      const rows = preview.rows
        .filter((r) => r.auvo_match && r.erro !== "inativo" && !skip[r.linha])
        .map((r) => ({
          linha: r.linha,
          codigo_barras_auvo: r.auvo_match!.identificador,
          auvo_equip_id: r.auvo_match!.id,
          categoria: r.categoria,
          criticidade: r.criticidade,
          periodicidade: r.periodicidade,
          ht_total: r.ht_total,
          mes_inicio_ciclo: r.mes_inicio_ciclo,
          conflitos: r.conflitos,
          apply_tipo: !!applyTipo[r.linha],
          overwrite_conflict: !!overwriteConflict[r.linha],
        }));
      const { data, error } = await supabase.functions.invoke("plano-preventivo-import", {
        body: { mode: "commit", grupo_id: grupoId, ano_referencia: ano, sheet, rows },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha ao gravar");
      toast.success(
        `Plano importado: ${data.planos_gravados} gravados, ${data.tipos_aplicados} tipos aplicados` +
        (data.pulados_conflito ? `, ${data.pulados_conflito} pulados (conflito)` : "") +
        (data.pulados_inativo ? `, ${data.pulados_inativo} inativos` : "")
      );
      onImported();
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error(`Erro no commit: ${e.message}`);
    } finally {
      setCommitting(false);
    }
  };

  const stats = preview?.stats;
  const podeGravar = useMemo(() => preview && preview.rows.some((r) => r.auvo_match && r.erro !== "inativo" && !skip[r.linha]), [preview, skip]);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Importar plano preventivo (Excel)</DialogTitle>
          <DialogDescription>
            Importa o plano de UMA casa por vez a partir da aba selecionada. Match estrito por ID (identificador Auvo).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-auto pr-2">
          {/* Step 1: setup */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Grupo</Label>
              <Select value={grupoId} onValueChange={setGrupoId}>
                <SelectTrigger><SelectValue placeholder="Selecione o grupo" /></SelectTrigger>
                <SelectContent>
                  {grupos.map((g) => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ano de referência</Label>
              <Input type="number" value={ano} onChange={(e) => setAno(Number(e.target.value) || new Date().getFullYear())} />
            </div>
            <div className="md:col-span-2">
              <Label>Arquivo Excel (.xlsx)</Label>
              <Input type="file" accept=".xlsx" onChange={(e) => handleFile(e.target.files?.[0] || null)} />
            </div>
          </div>

          {loadingSheets && <div className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Lendo abas...</div>}

          {sheets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <Label>Aba / casa</Label>
                <Select value={sheet} onValueChange={setSheet}>
                  <SelectTrigger><SelectValue placeholder="Escolha a casa" /></SelectTrigger>
                  <SelectContent>
                    {sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name} disabled={!s.header_ok || s.count === 0}>
                        {s.name} {s.header_ok ? `· ${s.count} equip.` : "· cabeçalho inválido"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={runPreview} disabled={previewing || !grupoId || !sheet}>
                {previewing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                Pré-visualizar
              </Button>
            </div>
          )}

          {/* Preview */}
          {preview && stats && (
            <div className="space-y-3 border-t pt-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="default" className="bg-emerald-600">{stats.casados} casados</Badge>
                {stats.nao_encontrados > 0 && <Badge variant="destructive">{stats.nao_encontrados} ID não encontrado</Badge>}
                {stats.sem_id > 0 && <Badge variant="destructive">{stats.sem_id} sem ID</Badge>}
                {stats.inativos > 0 && <Badge variant="secondary">{stats.inativos} inativos (pulados)</Badge>}
                {stats.com_conflito > 0 && <Badge className="bg-amber-500">{stats.com_conflito} conflitos</Badge>}
                {stats.orfaos_auvo > 0 && <Badge variant="outline">{stats.orfaos_auvo} Auvo fora do Excel</Badge>}
              </div>

              {/* Seleção rápida */}
              <div className="flex flex-wrap items-center gap-2 text-xs border rounded p-2 bg-muted/30">
                <span className="font-medium mr-1">Seleção rápida:</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                  // Gravar apenas equipamentos SEM plano atual
                  const newSkip: Record<number, boolean> = {};
                  for (const r of preview.rows) {
                    if (!r.auvo_match) continue;
                    newSkip[r.linha] = !!r.plano_atual; // pula quem já tem plano
                  }
                  setSkip(newSkip);
                }}>Só sem plano</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                  // Gravar apenas linhas com conflito
                  const newSkip: Record<number, boolean> = {};
                  const newOv: Record<number, boolean> = {};
                  for (const r of preview.rows) {
                    if (!r.auvo_match) continue;
                    const hasConf = r.conflitos.length > 0;
                    newSkip[r.linha] = !hasConf;
                    if (hasConf) newOv[r.linha] = true;
                  }
                  setSkip(newSkip);
                  setOverwriteConflict(newOv);
                }}>Só conflitos (sobrescrever)</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                  // Gravar todos (limpa skip), sobrescreve conflitos
                  setSkip({});
                  const ov: Record<number, boolean> = {};
                  for (const r of preview.rows) if (r.conflitos.length > 0) ov[r.linha] = true;
                  setOverwriteConflict(ov);
                }}>Todos (sobrescrever conflitos)</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                  // Marca skip em tudo
                  const newSkip: Record<number, boolean> = {};
                  for (const r of preview.rows) if (r.auvo_match) newSkip[r.linha] = true;
                  setSkip(newSkip);
                }}>Pular todos</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSkip({})}>Limpar "pular"</Button>
                <span className="mx-2 text-muted-foreground">|</span>
                <span className="font-medium mr-1">Tipo:</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                  const at: Record<number, boolean> = {};
                  for (const r of preview.rows) if (r.auvo_match) at[r.linha] = true;
                  setApplyTipo(at);
                }}>Aplicar em todos</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                  const at: Record<number, boolean> = {};
                  for (const r of preview.rows) if (r.auvo_match) at[r.linha] = !r.auvo_match.tipo_nome_atual;
                  setApplyTipo(at);
                }}>Só onde está vazio</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setApplyTipo({})}>Não aplicar</Button>
              </div>

              <div className="h-[45vh] border rounded overflow-auto">
                <table className="min-w-[1200px] w-max text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 text-left">L</th>
                      <th className="p-2 text-left">ID</th>
                      <th className="p-2 text-left">Equipamento (Excel)</th>
                      <th className="p-2 text-left">Match Auvo</th>
                      <th className="p-2 text-left">Categoria</th>
                      <th className="p-2 text-left">Perio.</th>
                      <th className="p-2 text-left">Crit</th>
                      <th className="p-2 text-right">HT</th>
                      <th className="p-2 text-center">Mês ini.</th>
                      <th className="p-2 text-center">Aplicar tipo</th>
                      <th className="p-2 text-center">Sobrescrever</th>
                      <th className="p-2 text-center">Pular</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => {
                      const hasConflict = r.conflitos.length > 0;
                      const noMatch = !r.auvo_match;
                      const inativo = r.erro === "inativo";
                      return (
                        <tr key={r.linha} className={
                          noMatch ? "bg-red-50 dark:bg-red-950/30" :
                          inativo ? "bg-zinc-100 dark:bg-zinc-900/40" :
                          hasConflict ? "bg-amber-50 dark:bg-amber-950/30" : ""
                        }>
                          <td className="p-2 align-top">{r.linha}</td>
                          <td className="p-2 align-top font-mono">{r.excel_id || <span className="text-red-600">—</span>}</td>
                          <td className="p-2 align-top max-w-[200px] truncate" title={r.excel_nome}>{r.excel_nome}</td>
                          <td className="p-2 align-top">
                            {noMatch ? (
                              <span className="text-red-600 flex items-center gap-1"><XCircle className="h-3 w-3" /> não encontrado</span>
                            ) : (
                              <div>
                                <div className="truncate max-w-[220px]" title={r.auvo_match!.nome}>{r.auvo_match!.nome}</div>
                                <div className="text-muted-foreground text-[10px]">{r.auvo_match!.cliente} {inativo && <span className="text-red-600">· INATIVO</span>}</div>
                                {r.auvo_match!.tipo_nome_atual && (
                                  <div className="text-[10px] text-blue-600">tipo atual: {r.auvo_match!.tipo_nome_atual}</div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="p-2 align-top">{r.categoria}</td>
                          <td className="p-2 align-top">{r.periodicidade}</td>
                          <td className="p-2 align-top">{r.criticidade}</td>
                          <td className="p-2 align-top text-right">{r.ht_total}</td>
                          <td className="p-2 align-top text-center">{r.mes_inicio_ciclo}</td>
                          <td className="p-2 align-top text-center">
                            {r.auvo_match && (
                              <Checkbox checked={!!applyTipo[r.linha]} onCheckedChange={(v) => setApplyTipo((s) => ({ ...s, [r.linha]: !!v }))} />
                            )}
                          </td>
                          <td className="p-2 align-top text-center">
                            {hasConflict && r.auvo_match && (
                              <div className="flex flex-col items-center gap-1">
                                <Checkbox checked={!!overwriteConflict[r.linha]} onCheckedChange={(v) => setOverwriteConflict((s) => ({ ...s, [r.linha]: !!v }))} />
                                <div className="text-[10px] text-amber-700 text-left">
                                  {r.conflitos.map((c) => (
                                    <div key={c.campo}>{c.campo}: <s>{String(c.atual)}</s> → <b>{String(c.excel)}</b></div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="p-2 align-top text-center">
                            {r.auvo_match && !inativo && (
                              <Checkbox checked={!!skip[r.linha]} onCheckedChange={(v) => setSkip((s) => ({ ...s, [r.linha]: !!v }))} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {preview.orfaos_auvo.length > 0 && (
                <details className="border rounded p-2 bg-muted/30">
                  <summary className="text-xs cursor-pointer flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {preview.orfaos_auvo.length} equipamentos Auvo ATIVOS deste grupo que NÃO estão no Excel</summary>
                  <ul className="text-xs mt-2 max-h-40 overflow-auto pl-4 list-disc">
                    {preview.orfaos_auvo.map((o) => (
                      <li key={o.id}><span className="font-mono">{o.identificador}</span> · {o.nome} <span className="text-muted-foreground">({o.cliente})</span></li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={committing}>Cancelar</Button>
          <Button onClick={commit} disabled={committing || !podeGravar}>
            {committing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
            Gravar plano
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}