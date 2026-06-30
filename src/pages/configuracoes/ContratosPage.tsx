import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Edit, Users, FileText, X } from "lucide-react";
import { toast } from "sonner";

type Grupo = { id: string; nome: string; criado_em: string };
type Membro = { id: string; grupo_id: string; cliente_nome: string };
type Contrato = {
  id: string;
  nome: string;
  grupo_id: string | null;
  cliente_nome: string | null;
  valor_hora: number;
  taxa_comissao_servico: number;
  taxa_comissao_peca: number;
  premiacao_preventiva_hora: number;
  horas_mes_contratadas: number | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  ativo: boolean;
  observacao: string | null;
};

export default function ContratosPage() {
  const qc = useQueryClient();
  const [grupoDialog, setGrupoDialog] = useState<{ open: boolean; grupo?: Grupo }>({ open: false });
  const [contratoDialog, setContratoDialog] = useState<{ open: boolean; contrato?: Contrato }>({ open: false });
  const [membrosDialog, setMembrosDialog] = useState<{ open: boolean; grupo?: Grupo }>({ open: false });

  const { data: grupos = [], isLoading: loadingGrupos } = useQuery({
    queryKey: ["grupos_clientes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grupos_clientes").select("*").order("nome");
      if (error) throw error;
      return data as Grupo[];
    },
  });

  const { data: contratos = [], isLoading: loadingContratos } = useQuery({
    queryKey: ["contratos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos").select("*").order("nome");
      if (error) throw error;
      return data as Contrato[];
    },
  });

  const { data: membros = [] } = useQuery({
    queryKey: ["grupo_cliente_membros"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grupo_cliente_membros").select("*").order("cliente_nome");
      if (error) throw error;
      return data as Membro[];
    },
  });

  const membrosByGrupo = membros.reduce<Record<string, Membro[]>>((acc, m) => {
    (acc[m.grupo_id] ||= []).push(m);
    return acc;
  }, {});

  const grupoNomeById = Object.fromEntries(grupos.map((g) => [g.id, g.nome]));

  const deleteGrupo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("grupos_clientes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grupos_clientes"] });
      qc.invalidateQueries({ queryKey: ["grupo_cliente_membros"] });
      qc.invalidateQueries({ queryKey: ["contratos"] });
      toast.success("Grupo excluído");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteContrato = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contratos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contratos"] });
      toast.success("Contrato excluído");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações · Contratos</h1>
        <p className="text-sm text-muted-foreground">
          Lance os contratos por grupo de clientes. O valor por hora será usado como base da premiação de serviços nas OS dos clientes do contrato.
        </p>
      </div>

      {/* Contratos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Contratos</CardTitle>
          <Button size="sm" onClick={() => setContratoDialog({ open: true })}>
            <Plus className="h-4 w-4 mr-1" /> Novo contrato
          </Button>
        </CardHeader>
        <CardContent>
          {loadingContratos ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : contratos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum contrato cadastrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Alvo</TableHead>
                  <TableHead className="text-right">R$/hora</TableHead>
                  <TableHead className="text-right">% Serv.</TableHead>
                  <TableHead className="text-right">% Peças</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contratos.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell>
                      {c.grupo_id
                        ? `Grupo: ${grupoNomeById[c.grupo_id] || "—"}`
                        : c.cliente_nome
                        ? `Cliente: ${c.cliente_nome}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">{c.valor_hora.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                    <TableCell className="text-right">{(c.taxa_comissao_servico * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{((c.taxa_comissao_peca ?? 0.02) * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.vigencia_inicio || "∞"} → {c.vigencia_fim || "∞"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.ativo ? "default" : "secondary"}>{c.ativo ? "Ativo" : "Inativo"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => setContratoDialog({ open: true, contrato: c })}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("Excluir contrato?")) deleteContrato.mutate(c.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Grupos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Grupos de clientes</CardTitle>
          <Button size="sm" onClick={() => setGrupoDialog({ open: true })}>
            <Plus className="h-4 w-4 mr-1" /> Novo grupo
          </Button>
        </CardHeader>
        <CardContent>
          {loadingGrupos ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : grupos.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum grupo cadastrado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Clientes</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grupos.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">{g.nome}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(membrosByGrupo[g.id] || []).length} cliente(s)
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setMembrosDialog({ open: true, grupo: g })}>
                        Gerenciar clientes
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setGrupoDialog({ open: true, grupo: g })}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("Excluir grupo e todos os contratos vinculados?")) deleteGrupo.mutate(g.id); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <GrupoDialog key={`g-${grupoDialog.grupo?.id ?? "new"}-${grupoDialog.open}`} state={grupoDialog} onClose={() => setGrupoDialog({ open: false })} />
      <ContratoDialog key={`c-${contratoDialog.contrato?.id ?? "new"}-${contratoDialog.open}`} state={contratoDialog} grupos={grupos} onClose={() => setContratoDialog({ open: false })} />
      <MembrosDialog state={membrosDialog} membros={membros} onClose={() => setMembrosDialog({ open: false })} />
    </div>
  );
}

function GrupoDialog({ state, onClose }: { state: { open: boolean; grupo?: Grupo }; onClose: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(state.grupo?.nome || "");

  const save = useMutation({
    mutationFn: async () => {
      if (!nome.trim()) throw new Error("Nome obrigatório");
      if (state.grupo) {
        const { error } = await supabase.from("grupos_clientes").update({ nome }).eq("id", state.grupo.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("grupos_clientes").insert({ nome });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grupos_clientes"] });
      toast.success("Grupo salvo");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) onClose(); else setNome(state.grupo?.nome || ""); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{state.grupo ? "Editar grupo" : "Novo grupo"}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Nome do grupo</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Rede ABC" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContratoDialog({
  state, grupos, onClose,
}: { state: { open: boolean; contrato?: Contrato }; grupos: Grupo[]; onClose: () => void }) {
  const qc = useQueryClient();
  const c = state.contrato;
  const [nome, setNome] = useState(c?.nome || "");
  const [tipo, setTipo] = useState<"grupo" | "cliente">(c?.cliente_nome ? "cliente" : "grupo");
  const [grupoId, setGrupoId] = useState(c?.grupo_id || "");
  const [clienteNome, setClienteNome] = useState(c?.cliente_nome || "");
  const [valorHora, setValorHora] = useState(String(c?.valor_hora ?? ""));
  const [taxa, setTaxa] = useState(String(((c?.taxa_comissao_servico ?? 0.15) * 100).toFixed(2)));
  const [taxaPeca, setTaxaPeca] = useState(String(((c?.taxa_comissao_peca ?? 0.02) * 100).toFixed(2)));
  const [prevHora, setPrevHora] = useState(String(c?.premiacao_preventiva_hora ?? ""));
  const [horasMes, setHorasMes] = useState(String(c?.horas_mes_contratadas ?? ""));
  const [vigIni, setVigIni] = useState(c?.vigencia_inicio || "");
  const [vigFim, setVigFim] = useState(c?.vigencia_fim || "");
  const [ativo, setAtivo] = useState(c?.ativo ?? true);
  const [obs, setObs] = useState(c?.observacao || "");

  const { data: clientesDisponiveis = [] } = useQuery({
    queryKey: ["clientes_distintos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("gc_os_cliente")
        .not("gc_os_cliente", "is", null)
        .limit(5000);
      if (error) throw error;
      const set = new Set<string>();
      (data || []).forEach((r: any) => { if (r.gc_os_cliente) set.add(r.gc_os_cliente); });
      return Array.from(set).sort();
    },
    enabled: state.open,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!nome.trim()) throw new Error("Nome obrigatório");
      if (tipo === "grupo" && !grupoId) throw new Error("Selecione um grupo");
      if (tipo === "cliente" && !clienteNome.trim()) throw new Error("Informe o cliente");
      const payload = {
        nome,
        grupo_id: tipo === "grupo" ? grupoId : null,
        cliente_nome: tipo === "cliente" ? clienteNome.trim() : null,
        valor_hora: parseFloat(valorHora.replace(",", ".")) || 0,
        taxa_comissao_servico: (parseFloat(taxa.replace(",", ".")) || 0) / 100,
        taxa_comissao_peca: (parseFloat(taxaPeca.replace(",", ".")) || 0) / 100,
        premiacao_preventiva_hora: parseFloat(prevHora.replace(",", ".")) || 0,
        horas_mes_contratadas: horasMes ? (parseFloat(horasMes.replace(",", ".")) || null) : null,
        vigencia_inicio: vigIni || null,
        vigencia_fim: vigFim || null,
        ativo,
        observacao: obs || null,
      };
      if (c) {
        const { error } = await supabase.from("contratos").update(payload).eq("id", c.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("contratos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contratos"] });
      toast.success("Contrato salvo");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={state.open} onOpenChange={(o) => {
      if (!o) onClose();
      else {
        setNome(c?.nome || "");
        setTipo(c?.cliente_nome ? "cliente" : "grupo");
        setGrupoId(c?.grupo_id || "");
        setClienteNome(c?.cliente_nome || "");
        setValorHora(String(c?.valor_hora ?? "")); setTaxa(String(((c?.taxa_comissao_servico ?? 0.15) * 100).toFixed(2)));
        setTaxaPeca(String(((c?.taxa_comissao_peca ?? 0.02) * 100).toFixed(2)));
        setPrevHora(String(c?.premiacao_preventiva_hora ?? ""));
        setHorasMes(String(c?.horas_mes_contratadas ?? ""));
        setVigIni(c?.vigencia_inicio || ""); setVigFim(c?.vigencia_fim || "");
        setAtivo(c?.ativo ?? true); setObs(c?.observacao || "");
      }
    }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{c ? "Editar contrato" : "Novo contrato"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome do contrato</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} /></div>
          <div>
            <Label>Aplicar a</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as "grupo" | "cliente")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="grupo">Grupo de clientes</SelectItem>
                <SelectItem value="cliente">Cliente específico</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tipo === "grupo" ? (
            <div>
              <Label>Grupo de clientes</Label>
              <Select value={grupoId} onValueChange={setGrupoId}>
                <SelectTrigger><SelectValue placeholder={grupos.length === 0 ? "Crie um grupo primeiro" : "Selecione"} /></SelectTrigger>
                <SelectContent>
                  {grupos.map((g) => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label>Cliente</Label>
              <Input
                list="contrato-clientes-list"
                value={clienteNome}
                onChange={(e) => setClienteNome(e.target.value)}
                placeholder="Digite ou selecione um cliente"
              />
              <datalist id="contrato-clientes-list">
                {clientesDisponiveis.map((cn) => <option key={cn} value={cn} />)}
              </datalist>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Valor por hora (R$)</Label><Input value={valorHora} onChange={(e) => setValorHora(e.target.value)} placeholder="0,00" /></div>
            <div><Label>% Premiação serviços</Label><Input value={taxa} onChange={(e) => setTaxa(e.target.value)} placeholder="15" /></div>
            <div><Label>% Premiação peças</Label><Input value={taxaPeca} onChange={(e) => setTaxaPeca(e.target.value)} placeholder="2" /></div>
          </div>
          <div>
            <Label>Premiação por hora de preventiva (R$)</Label>
            <Input value={prevHora} onChange={(e) => setPrevHora(e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <Label>Banco de horas mensal contratado (h)</Label>
            <Input value={horasMes} onChange={(e) => setHorasMes(e.target.value)} placeholder="Ex: 60" />
            <p className="text-xs text-muted-foreground mt-1">Usado como teto para calcular saldo do mês no Plano Preventivo.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Vigência início</Label><Input type="date" value={vigIni} onChange={(e) => setVigIni(e.target.value)} /></div>
            <div><Label>Vigência fim</Label><Input type="date" value={vigFim} onChange={(e) => setVigFim(e.target.value)} /></div>
          </div>
          <div><Label>Observação</Label><Input value={obs} onChange={(e) => setObs(e.target.value)} /></div>
          <div className="flex items-center gap-2"><Switch checked={ativo} onCheckedChange={setAtivo} /><Label>Ativo</Label></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembrosDialog({
  state, membros, onClose,
}: { state: { open: boolean; grupo?: Grupo }; membros: Membro[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState("");
  const g = state.grupo;
  const lista = g ? membros.filter((m) => m.grupo_id === g.id) : [];

  const { data: clientesDisponiveis = [] } = useQuery({
    queryKey: ["clientes_distintos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarefas_central")
        .select("gc_os_cliente")
        .not("gc_os_cliente", "is", null)
        .limit(5000);
      if (error) throw error;
      const set = new Set<string>();
      (data || []).forEach((r: any) => { if (r.gc_os_cliente) set.add(r.gc_os_cliente); });
      return Array.from(set).sort();
    },
    enabled: state.open,
  });

  const add = useMutation({
    mutationFn: async (nome: string) => {
      if (!g || !nome.trim()) throw new Error("Inválido");
      const { error } = await supabase.from("grupo_cliente_membros").insert({ grupo_id: g.id, cliente_nome: nome });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["grupo_cliente_membros"] }); setNovo(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("grupo_cliente_membros").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grupo_cliente_membros"] }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Clientes de "{g?.nome}"</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              list="clientes-list"
              value={novo}
              onChange={(e) => setNovo(e.target.value)}
              placeholder="Digite ou selecione um cliente"
              onKeyDown={(e) => { if (e.key === "Enter" && novo.trim()) add.mutate(novo.trim()); }}
            />
            <datalist id="clientes-list">
              {clientesDisponiveis.map((c) => <option key={c} value={c} />)}
            </datalist>
            <Button onClick={() => novo.trim() && add.mutate(novo.trim())} disabled={add.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-80 overflow-auto border rounded-md divide-y">
            {lista.length === 0 && <p className="text-sm text-muted-foreground p-4 text-center">Nenhum cliente</p>}
            {lista.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-2 text-sm">
                <span>{m.cliente_nome}</span>
                <Button size="icon" variant="ghost" onClick={() => remove.mutate(m.id)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter><Button onClick={onClose}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}