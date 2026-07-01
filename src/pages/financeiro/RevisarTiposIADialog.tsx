import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Sparkles, CheckCircle2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Grupo = { id: string; nome: string };

function FilterBadge({
  active, onClick, children, variant, className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "outline" | "secondary" | "destructive" | "default";
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} className={active ? "ring-2 ring-offset-1 ring-primary rounded-full" : ""}>
      <Badge variant={variant} className={className + " cursor-pointer hover:opacity-80"}>{children}</Badge>
    </button>
  );
}

type Sugestao = {
  equip_id: string;
  identificador: string;
  nome: string;
  cliente: string;
  tipo_atual_id: string | null;
  tipo_atual_nome: string | null;
  tipo_sugerido_id: string | null;
  tipo_sugerido_nome: string | null;
  confianca: number;
  motivo: string;
  mudou: boolean;
};

export default function RevisarTiposIADialog({
  open, onOpenChange, grupos, clientes, onApplied, selectedIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grupos: Grupo[];
  clientes: string[];
  onApplied: () => void;
  selectedIds?: string[];
}) {
  const [escopo, setEscopo] = useState<"grupo" | "cliente" | "selecionados">(
    (selectedIds && selectedIds.length) ? "selecionados" : "grupo"
  );
  const [grupoId, setGrupoId] = useState<string>("");
  const [cliente, setCliente] = useState<string>("");
  const [apenasSemTipo, setApenasSemTipo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [sugestoes, setSugestoes] = useState<Sugestao[] | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [filtro, setFiltro] = useState<"todos" | "mudam" | "alta" | "media" | "baixa" | "sem_sugestao" | "selecionados">("todos");

  // Sempre que o diálogo abrir com equipamentos selecionados, força escopo "selecionados"
  useEffect(() => {
    if (open && selectedIds && selectedIds.length > 0) {
      setEscopo("selecionados");
    }
  }, [open, selectedIds]);

  const reset = () => {
    setSugestoes(null); setSel({}); setFiltro("todos");
  };

  const analisar = async () => {
    if (escopo === "grupo" && !grupoId) { toast.error("Selecione um grupo"); return; }
    if (escopo === "cliente" && !cliente) { toast.error("Selecione um cliente"); return; }
    if (escopo === "selecionados" && !(selectedIds && selectedIds.length)) {
      toast.error("Nenhum equipamento selecionado na lista"); return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("equipamentos-revisar-tipos", {
        body: {
          mode: "analyze",
          grupo_id: escopo === "grupo" ? grupoId : null,
          cliente: escopo === "cliente" ? cliente : null,
          equip_ids: escopo === "selecionados" ? selectedIds : null,
          apenas_sem_tipo: apenasSemTipo,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha");
      const sug = (data.sugestoes as Sugestao[]) ?? [];
      setSugestoes(sug);
      // marca por padrão apenas as que mudaram com confiança >= 70
      const initial: Record<string, boolean> = {};
      for (const s of sug) initial[s.equip_id] = s.mudou && s.confianca >= 70;
      setSel(initial);
      toast.success(`${sug.length} equipamentos analisados`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const aplicar = async () => {
    if (!sugestoes) return;
    const updates = sugestoes
      .filter((s) => sel[s.equip_id] && s.mudou)
      .map((s) => ({ equip_id: s.equip_id, tipo_id: s.tipo_sugerido_id }));
    if (!updates.length) { toast.error("Nada selecionado"); return; }
    setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke("equipamentos-revisar-tipos", {
        body: { mode: "apply", updates },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha");
      toast.success(`${data.aplicados} tipos atualizados` + (data.falhas ? ` (${data.falhas} falhas)` : ""));
      // Atualiza a análise em memória: itens aplicados viram "tipo atual = sugerido" e saem da lista de mudanças
      const aplicadosIds = new Set(updates.map((u) => u.equip_id));
      setSugestoes((prev) => prev ? prev.map((s) => aplicadosIds.has(s.equip_id) ? {
        ...s,
        tipo_atual_id: s.tipo_sugerido_id,
        tipo_atual_nome: s.tipo_sugerido_nome,
        mudou: false,
        motivo: "✓ Aplicado",
      } : s) : prev);
      setSel((prev) => {
        const next = { ...prev };
        for (const id of aplicadosIds) delete next[id];
        return next;
      });
      onApplied(); // refresca a lista da página por trás, mas NÃO fecha o diálogo
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setApplying(false);
    }
  };

  const stats = useMemo(() => {
    if (!sugestoes) return null;
    return {
      total: sugestoes.length,
      mudam: sugestoes.filter((s) => s.mudou).length,
      alta: sugestoes.filter((s) => s.mudou && s.confianca >= 80).length,
      media: sugestoes.filter((s) => s.mudou && s.confianca >= 50 && s.confianca < 80).length,
      baixa: sugestoes.filter((s) => s.mudou && s.confianca < 50).length,
      sem_sugestao: sugestoes.filter((s) => !s.tipo_sugerido_id).length,
      selecionados: Object.values(sel).filter(Boolean).length,
    };
  }, [sugestoes, sel]);

  const selecionarTodos = (v: boolean) => {
    if (!sugestoes) return;
    const m: Record<string, boolean> = {};
    for (const s of sugestoes) if (s.mudou) m[s.equip_id] = v;
    setSel(m);
  };
  const selecionarPorConfianca = (min: number) => {
    if (!sugestoes) return;
    const m: Record<string, boolean> = {};
    for (const s of sugestoes) m[s.equip_id] = s.mudou && s.confianca >= min;
    setSel(m);
  };
  const selecionarSemTipo = () => {
    if (!sugestoes) return;
    const m: Record<string, boolean> = {};
    for (const s of sugestoes) m[s.equip_id] = !s.tipo_atual_id && !!s.tipo_sugerido_id;
    setSel(m);
  };

  const sugestoesFiltradas = useMemo(() => {
    if (!sugestoes) return [];
    switch (filtro) {
      case "mudam": return sugestoes.filter((s) => s.mudou);
      case "alta": return sugestoes.filter((s) => s.mudou && s.confianca >= 80);
      case "media": return sugestoes.filter((s) => s.mudou && s.confianca >= 50 && s.confianca < 80);
      case "baixa": return sugestoes.filter((s) => s.mudou && s.confianca < 50);
      case "sem_sugestao": return sugestoes.filter((s) => !s.tipo_sugerido_id);
      case "selecionados": return sugestoes.filter((s) => sel[s.equip_id]);
      default: return sugestoes;
    }
  }, [sugestoes, filtro, sel]);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-500" /> Revisar tipos com IA
          </DialogTitle>
          <DialogDescription>
            A IA analisa o nome de cada equipamento e sugere a categoria correta. Você revisa e escolhe quais aplicar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-auto pr-2">
          {/* Escopo */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Escopo</Label>
              <Select value={escopo} onValueChange={(v) => setEscopo(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {selectedIds && selectedIds.length > 0 && (
                    <SelectItem value="selecionados">Selecionados na lista ({selectedIds.length})</SelectItem>
                  )}
                  <SelectItem value="grupo">Por grupo</SelectItem>
                  <SelectItem value="cliente">Por cliente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {escopo === "selecionados" ? (
              <div className="md:col-span-2 text-sm text-muted-foreground pb-2">
                A IA irá analisar os <strong>{selectedIds?.length ?? 0}</strong> equipamento(s) marcados na lista.
              </div>
            ) : escopo === "grupo" ? (
              <div className="md:col-span-2">
                <Label>Grupo</Label>
                <Select value={grupoId} onValueChange={setGrupoId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {grupos.map((g) => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="md:col-span-2">
                <Label>Cliente</Label>
                <SearchableSelect
                  value={cliente}
                  onValueChange={setCliente}
                  options={clientes.map((c) => ({ value: c, label: c }))}
                  placeholder="Selecione cliente"
                />
              </div>
            )}
            <div className="flex items-center gap-2 pb-2">
              <Switch id="semtipo" checked={apenasSemTipo} onCheckedChange={setApenasSemTipo} />
              <Label htmlFor="semtipo" className="text-xs">Só sem tipo</Label>
            </div>
          </div>

          <Button onClick={analisar} disabled={loading} className="w-full md:w-auto">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Analisar com IA
          </Button>

          {stats && (
            <div className="space-y-2 border-t pt-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <FilterBadge active={filtro === "todos"} onClick={() => setFiltro("todos")} variant="outline">{stats.total} analisados</FilterBadge>
                <FilterBadge active={filtro === "mudam"} onClick={() => setFiltro("mudam")} className="bg-amber-500">{stats.mudam} sugerem mudança</FilterBadge>
                {stats.alta > 0 && <FilterBadge active={filtro === "alta"} onClick={() => setFiltro("alta")} className="bg-emerald-600">{stats.alta} alta conf.</FilterBadge>}
                {stats.media > 0 && <FilterBadge active={filtro === "media"} onClick={() => setFiltro("media")} className="bg-blue-500">{stats.media} média conf.</FilterBadge>}
                {stats.baixa > 0 && <FilterBadge active={filtro === "baixa"} onClick={() => setFiltro("baixa")} variant="destructive">{stats.baixa} baixa conf.</FilterBadge>}
                {stats.sem_sugestao > 0 && <FilterBadge active={filtro === "sem_sugestao"} onClick={() => setFiltro("sem_sugestao")} variant="secondary">{stats.sem_sugestao} sem sugestão</FilterBadge>}
                <FilterBadge active={filtro === "selecionados"} onClick={() => setFiltro("selecionados")}>{stats.selecionados} selecionados</FilterBadge>
                {filtro !== "todos" && (
                  <button className="text-xs underline text-muted-foreground" onClick={() => setFiltro("todos")}>limpar filtro</button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => selecionarTodos(true)}>Marcar todos que mudam</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => selecionarTodos(false)}>Desmarcar todos</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => selecionarPorConfianca(80)}>≥ 80% confiança</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => selecionarPorConfianca(50)}>≥ 50% confiança</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={selecionarSemTipo}>Todos sem tipo (com sugestão)</Button>
              </div>

              <div className="h-[50vh] border rounded overflow-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="p-2 w-8"></th>
                      <th className="p-2 text-left">Equipamento</th>
                      <th className="p-2 text-left">Cliente</th>
                      <th className="p-2 text-left">Tipo atual</th>
                      <th className="p-2"></th>
                      <th className="p-2 text-left">Sugerido</th>
                      <th className="p-2 text-right">Conf.</th>
                      <th className="p-2 text-left">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sugestoesFiltradas.length === 0 && (
                      <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Nenhum item nesse filtro.</td></tr>
                    )}
                    {sugestoesFiltradas.map((s) => (
                      <tr key={s.equip_id} className={
                        !s.mudou ? "opacity-50" :
                        s.confianca >= 80 ? "bg-emerald-50 dark:bg-emerald-950/20" :
                        s.confianca >= 50 ? "" : "bg-amber-50 dark:bg-amber-950/20"
                      }>
                        <td className="p-2 text-center">
                          {s.mudou && (
                            <Checkbox
                              checked={!!sel[s.equip_id]}
                              onCheckedChange={(v) => setSel((m) => ({ ...m, [s.equip_id]: !!v }))}
                            />
                          )}
                        </td>
                        <td className="p-2 max-w-[220px] truncate" title={s.nome}>{s.nome}</td>
                        <td className="p-2 text-muted-foreground">{s.cliente}</td>
                        <td className="p-2">{s.tipo_atual_nome || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="p-2 text-center text-muted-foreground"><ArrowRight className="h-3 w-3 inline" /></td>
                        <td className="p-2 font-medium">{s.tipo_sugerido_nome || <span className="text-muted-foreground italic">— sem sugestão —</span>}</td>
                        <td className="p-2 text-right">{s.confianca}%</td>
                        <td className="p-2 text-muted-foreground max-w-[260px] truncate" title={s.motivo}>{s.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>Cancelar</Button>
          <Button onClick={aplicar} disabled={applying || !stats?.selecionados}>
            {applying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
            Aplicar selecionados ({stats?.selecionados ?? 0})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}