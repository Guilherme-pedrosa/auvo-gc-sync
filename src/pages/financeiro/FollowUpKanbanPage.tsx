import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, RefreshCw, Plus, ExternalLink, Trash2, Edit2, Check, X, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { toast } from "sonner";

type Coluna = {
  id: string;
  titulo: string;
  ordem: number;
  eh_situacao: boolean;
  situacao_id: string | null;
};

type OrcDados = {
  gc_orcamento_id: string;
  gc_orcamento_codigo: string;
  cliente: string;
  situacao_id: string;
  situacao: string;
  cor_situacao: string;
  valor_total: number;
  vendedor: string;
  data: string;
  link: string;
};

type CacheItem = {
  gc_orcamento_id: string;
  coluna: string;
  posicao: number;
  situacao_id_origem: string;
  dados: OrcDados;
};

const formatBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

const formatDate = (s: string) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("pt-BR");
};

export default function FollowUpKanbanPage() {
  const navigate = useNavigate();
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [itens, setItens] = useState<CacheItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [novaCol, setNovaCol] = useState("");
  const [showNova, setShowNova] = useState(false);
  const [editandoColId, setEditandoColId] = useState<string | null>(null);
  const [editandoColTitulo, setEditandoColTitulo] = useState("");
  const [selecionado, setSelecionado] = useState<CacheItem | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("followup-kanban", {
      body: { action: "load" },
    });
    setLoading(false);
    if (error || !data?.ok) {
      toast.error("Erro ao carregar kanban");
      return;
    }
    setColunas(data.colunas || []);
    setItens(data.itens || []);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const sincronizar = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("followup-kanban", {
      body: { action: "sync" },
    });
    setSyncing(false);
    if (error || !data?.ok) {
      toast.error(data?.error || "Erro na sincronização");
      return;
    }
    toast.success(
      `Sync: ${data.total} orçamentos · ${data.inseridos} novos · ${data.movidos} movidos · ${data.mantidos} mantidos`,
    );
    await carregar();
  };

  const itensFiltrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter((it) => {
      const d = it.dados;
      return (
        d.cliente?.toLowerCase().includes(q) ||
        d.gc_orcamento_codigo?.toLowerCase().includes(q) ||
        d.vendedor?.toLowerCase().includes(q)
      );
    });
  }, [itens, search]);

  const itensPorColuna = useMemo(() => {
    const map = new Map<string, CacheItem[]>();
    for (const c of colunas) map.set(c.id, []);
    for (const it of itensFiltrados) {
      if (!map.has(it.coluna)) map.set(it.coluna, []);
      map.get(it.coluna)!.push(it);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.posicao - b.posicao);
    return map;
  }, [colunas, itensFiltrados]);

  const totalPorColuna = useMemo(() => {
    const m = new Map<string, number>();
    for (const [cid, arr] of itensPorColuna) {
      m.set(cid, arr.reduce((sum, it) => sum + (it.dados.valor_total || 0), 0));
    }
    return m;
  }, [itensPorColuna]);

  const onDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // Atualização otimista local
    const novaLista = [...itens];
    const movido = novaLista.find((i) => i.gc_orcamento_id === draggableId);
    if (!movido) return;
    movido.coluna = destination.droppableId;

    // Recalcula posições dentro de cada coluna afetada
    const reorder = (colId: string) => {
      const arr = novaLista
        .filter((i) => i.coluna === colId)
        .sort((a, b) => a.posicao - b.posicao);
      // Remove o item movido temporariamente
      const filtered = arr.filter((i) => i.gc_orcamento_id !== draggableId);
      if (colId === destination.droppableId) {
        filtered.splice(destination.index, 0, movido);
      }
      filtered.forEach((i, idx) => { i.posicao = idx; });
    };
    reorder(source.droppableId);
    if (source.droppableId !== destination.droppableId) reorder(destination.droppableId);

    setItens(novaLista);

    // Persiste todas as posições das colunas afetadas
    const afetados = novaLista.filter(
      (i) => i.coluna === source.droppableId || i.coluna === destination.droppableId,
    );
    const updates = afetados.map((i) => ({
      gc_orcamento_id: i.gc_orcamento_id,
      coluna: i.coluna,
      posicao: i.posicao,
    }));
    const { data, error } = await supabase.functions.invoke("followup-kanban", {
      body: { action: "reorder", updates },
    });
    if (error || !data?.ok) {
      toast.error("Erro ao salvar movimentação");
      await carregar();
    }
  };

  const adicionarColuna = async () => {
    const titulo = novaCol.trim();
    if (!titulo) return;
    const { data, error } = await supabase.functions.invoke("followup-kanban", {
      body: { action: "add_column", titulo },
    });
    if (error || !data?.ok) {
      toast.error(data?.error || "Erro ao criar coluna");
      return;
    }
    setNovaCol("");
    setShowNova(false);
    await carregar();
  };

  const renomearColuna = async (id: string) => {
    const titulo = editandoColTitulo.trim();
    if (!titulo) return;
    const { data, error } = await supabase.functions.invoke("followup-kanban", {
      body: { action: "rename_column", id, titulo },
    });
    if (error || !data?.ok) {
      toast.error("Erro ao renomear");
      return;
    }
    setEditandoColId(null);
    await carregar();
  };

  const deletarColuna = async (id: string) => {
    if (!confirm("Deletar esta coluna? (precisa estar vazia)")) return;
    const { data, error } = await supabase.functions.invoke("followup-kanban", {
      body: { action: "delete_column", id },
    });
    if (error || !data?.ok) {
      toast.error(data?.error || "Erro ao deletar");
      return;
    }
    await carregar();
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <header className="border-b bg-card px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Kanban de Follow Up</h1>
          <p className="text-xs text-muted-foreground">
            Orçamentos GC nas situações configuradas · movimentação manual fica permanente até a situação mudar no GC
          </p>
        </div>
        <Input
          placeholder="Buscar cliente, código, vendedor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Button variant="outline" size="sm" onClick={() => setShowNova(true)}>
          <Plus className="h-4 w-4 mr-1" /> Coluna
        </Button>
        <Button size="sm" onClick={sincronizar} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Sincronizando..." : "Sincronizar"}
        </Button>
      </header>

      {showNova && (
        <div className="border-b bg-muted/30 px-6 py-2 flex items-center gap-2">
          <Input
            autoFocus
            placeholder="Nome da nova coluna"
            value={novaCol}
            onChange={(e) => setNovaCol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adicionarColuna()}
            className="max-w-xs"
          />
          <Button size="sm" onClick={adicionarColuna}>Criar</Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowNova(false); setNovaCol(""); }}>Cancelar</Button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="text-center text-muted-foreground py-8">Carregando...</div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-3 min-h-full">
              {colunas.map((col) => {
                const arr = itensPorColuna.get(col.id) || [];
                return (
                  <div
                    key={col.id}
                    className="flex-shrink-0 w-72 bg-muted/40 rounded-lg flex flex-col max-h-full"
                  >
                    <div className="px-3 py-2 border-b flex items-center gap-2">
                      {col.eh_situacao && (
                        <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      )}
                      {editandoColId === col.id ? (
                        <>
                          <Input
                            autoFocus
                            value={editandoColTitulo}
                            onChange={(e) => setEditandoColTitulo(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && renomearColuna(col.id)}
                            className="h-7 text-sm"
                          />
                          <button onClick={() => renomearColuna(col.id)}>
                            <Check className="h-4 w-4 text-primary" />
                          </button>
                          <button onClick={() => setEditandoColId(null)}>
                            <X className="h-4 w-4 text-muted-foreground" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium flex-1 truncate" title={col.titulo}>
                            {col.titulo}
                          </span>
                          <Badge variant="secondary" className="text-xs">{arr.length}</Badge>
                          <button
                            onClick={() => {
                              setEditandoColId(col.id);
                              setEditandoColTitulo(col.titulo);
                            }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          {!col.eh_situacao && (
                            <button
                              onClick={() => deletarColuna(col.id)}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="px-3 py-1 text-[11px] text-muted-foreground border-b">
                      Total: {formatBRL(totalPorColuna.get(col.id) || 0)}
                    </div>
                    <Droppable droppableId={col.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 overflow-y-auto p-2 space-y-2 ${
                            snapshot.isDraggingOver ? "bg-muted/60" : ""
                          }`}
                        >
                          {arr.map((it, idx) => (
                            <Draggable
                              key={it.gc_orcamento_id}
                              draggableId={it.gc_orcamento_id}
                              index={idx}
                            >
                              {(p, snap) => (
                                <div
                                  ref={p.innerRef}
                                  {...p.draggableProps}
                                  {...p.dragHandleProps}
                                  onClick={() => setSelecionado(it)}
                                  className={`bg-card rounded-md border p-2 cursor-pointer hover:border-primary transition-colors ${
                                    snap.isDragging ? "shadow-lg" : ""
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-mono text-muted-foreground">
                                      #{it.dados.gc_orcamento_codigo || it.gc_orcamento_id}
                                    </span>
                                    <span className="text-xs font-semibold text-primary">
                                      {formatBRL(it.dados.valor_total)}
                                    </span>
                                  </div>
                                  <div className="text-sm font-medium mt-1 line-clamp-2">
                                    {it.dados.cliente || "—"}
                                  </div>
                                  <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
                                    <span className="truncate">{it.dados.vendedor || "—"}</span>
                                    <span>{formatDate(it.dados.data)}</span>
                                  </div>
                                  {it.situacao_id_origem !== col.situacao_id && (
                                    <Badge
                                      variant="outline"
                                      className="mt-1.5 text-[10px]"
                                      style={{
                                        borderColor: it.dados.cor_situacao || undefined,
                                        color: it.dados.cor_situacao || undefined,
                                      }}
                                    >
                                      {it.dados.situacao}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                          {arr.length === 0 && (
                            <div className="text-center text-xs text-muted-foreground/60 py-6">
                              vazio
                            </div>
                          )}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        )}
      </div>

      <Dialog open={!!selecionado} onOpenChange={(v) => !v && setSelecionado(null)}>
        <DialogContent className="max-w-lg">
          {selecionado && (
            <>
              <DialogHeader>
                <DialogTitle>
                  Orçamento #{selecionado.dados.gc_orcamento_codigo || selecionado.gc_orcamento_id}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> {selecionado.dados.cliente}</div>
                <div><span className="text-muted-foreground">Vendedor:</span> {selecionado.dados.vendedor}</div>
                <div><span className="text-muted-foreground">Data:</span> {formatDate(selecionado.dados.data)}</div>
                <div><span className="text-muted-foreground">Valor:</span> <strong>{formatBRL(selecionado.dados.valor_total)}</strong></div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Situação atual no GC:</span>
                  <Badge style={{ backgroundColor: selecionado.dados.cor_situacao || undefined, color: "#fff" }}>
                    {selecionado.dados.situacao}
                  </Badge>
                </div>
                <a
                  href={selecionado.dados.link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline text-sm mt-2"
                >
                  Abrir no GestãoClick <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}