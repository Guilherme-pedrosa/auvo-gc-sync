import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Users, DollarSign, Loader2, AlertTriangle, ChevronsUpDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface Props {
  grupos: any[];
  membros: any[];
  allClientes: string[];
  allTecnicos: string[];
  valorHoraConfigs: any[];
  onRefresh: () => void;
}

export default function ConfiguracoesTab({ grupos, membros, allClientes, allTecnicos, valorHoraConfigs, onRefresh }: Props) {
  // Group CRUD
  const [newGrupoNome, setNewGrupoNome] = useState("");
  const [addingGrupo, setAddingGrupo] = useState(false);
  const [selectedGrupo, setSelectedGrupo] = useState<string | null>(null);
  const [newMembroCliente, setNewMembroCliente] = useState("");
  // Bulk add state: per-grupo selected client names + open state
  const [bulkSelection, setBulkSelection] = useState<Record<string, string[]>>({});
  const [bulkOpen, setBulkOpen] = useState<Record<string, boolean>>({});
  const [bulkAdding, setBulkAdding] = useState<string | null>(null);

  // Valor hora CRUD
  const [vhTecnico, setVhTecnico] = useState("");
  const [vhTipoRef, setVhTipoRef] = useState("cliente");
  const [vhRefNome, setVhRefNome] = useState("");
  const [vhGrupoId, setVhGrupoId] = useState("");
  const [vhValor, setVhValor] = useState("");
  const [vhValorFds, setVhValorFds] = useState("");
  const [vhAplicaEmerg, setVhAplicaEmerg] = useState(false);
  const [vhTaxaEmerg, setVhTaxaEmerg] = useState("");
  const [vhTaskTypesEmerg, setVhTaskTypesEmerg] = useState("201522");
  const [addingVH, setAddingVH] = useState(false);

  const handleAddGrupo = async () => {
    if (!newGrupoNome.trim()) return;
    setAddingGrupo(true);
    const { error } = await supabase.from("grupos_clientes").insert({ nome: newGrupoNome.trim() });
    setAddingGrupo(false);
    if (error) { toast.error("Erro ao criar grupo"); return; }
    toast.success("Grupo criado!");
    setNewGrupoNome("");
    onRefresh();
  };

  const handleDeleteGrupo = async (id: string) => {
    await supabase.from("grupos_clientes").delete().eq("id", id);
    toast.success("Grupo removido");
    onRefresh();
  };

  const handleAddMembro = async () => {
    if (!selectedGrupo || !newMembroCliente) return;
    const { error } = await supabase.from("grupo_cliente_membros").insert({
      grupo_id: selectedGrupo,
      cliente_nome: newMembroCliente,
    });
    if (error) {
      if (error.code === "23505") toast.error("Cliente já está neste grupo");
      else toast.error("Erro ao adicionar");
      return;
    }
    toast.success("Cliente adicionado ao grupo!");
    setNewMembroCliente("");
    onRefresh();
  };

  const handleAddMembrosBulk = async (grupoId: string) => {
    const selected = bulkSelection[grupoId] || [];
    if (selected.length === 0) return;
    setBulkAdding(grupoId);
    const rows = selected.map((cliente_nome) => ({ grupo_id: grupoId, cliente_nome }));
    const { error } = await supabase.from("grupo_cliente_membros").insert(rows);
    setBulkAdding(null);
    if (error) {
      toast.error("Erro ao adicionar clientes");
      return;
    }
    toast.success(`${selected.length} cliente(s) adicionado(s)!`);
    setBulkSelection((s) => ({ ...s, [grupoId]: [] }));
    setBulkOpen((s) => ({ ...s, [grupoId]: false }));
    onRefresh();
  };

  const handleDeleteMembro = async (id: string) => {
    await supabase.from("grupo_cliente_membros").delete().eq("id", id);
    toast.success("Removido");
    onRefresh();
  };

  const handleAddValorHora = async () => {
    if (!vhTecnico || !vhValor) return;
    setAddingVH(true);

    const insert: any = {
      tecnico_nome: vhTecnico,
      tipo_referencia: vhTipoRef,
      referencia_nome: vhTipoRef === "cliente" ? vhRefNome : grupos.find((g: any) => g.id === vhGrupoId)?.nome || "",
      grupo_id: vhTipoRef === "grupo" ? vhGrupoId : null,
      valor_hora: parseFloat(vhValor),
      valor_hora_fds: vhValorFds ? parseFloat(vhValorFds) : null,
      aplica_taxa_emergencial: vhAplicaEmerg,
      taxa_fixa_emergencial: vhAplicaEmerg && vhTaxaEmerg ? parseFloat(vhTaxaEmerg) : null,
      task_types_emergenciais: (vhTaskTypesEmerg || "").trim() || null,
    };

    const { error } = await supabase.from("valor_hora_config").insert(insert);
    setAddingVH(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Valor/hora cadastrado!");
    setVhValor("");
    setVhValorFds("");
    setVhTaxaEmerg("");
    onRefresh();
  };

  const handleDeleteVH = async (id: string) => {
    await supabase.from("valor_hora_config").delete().eq("id", id);
    toast.success("Removido");
    onRefresh();
  };

  // ── Limites de alerta de horas ──────────────────────────────────────
  const [alertaCfg, setAlertaCfg] = useState<any>({
    id: null,
    limite_minimo_minutos: 45,
    limite_maximo_horas: 8,
    limite_excessivo_horas: 12,
    detectar_overlap_tecnico: true,
    detectar_horas_negativas: true,
    curta_requer_revisao: true,
    longa_requer_revisao: false,
    excessiva_requer_revisao: true,
    negativa_requer_revisao: true,
    overlap_requer_revisao: true,
    sem_checkout_requer_revisao: true,
  });
  const [savingAlertaCfg, setSavingAlertaCfg] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("alertas_horas_config")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (data) setAlertaCfg(data);
    })();
  }, []);

  const handleSaveAlertaCfg = async () => {
    setSavingAlertaCfg(true);
    const payload = {
      limite_minimo_minutos: Number(alertaCfg.limite_minimo_minutos) || 45,
      limite_maximo_horas: Number(alertaCfg.limite_maximo_horas) || 8,
      limite_excessivo_horas: Number(alertaCfg.limite_excessivo_horas) || 12,
      detectar_overlap_tecnico: !!alertaCfg.detectar_overlap_tecnico,
      detectar_horas_negativas: !!alertaCfg.detectar_horas_negativas,
      curta_requer_revisao: !!alertaCfg.curta_requer_revisao,
      longa_requer_revisao: !!alertaCfg.longa_requer_revisao,
      excessiva_requer_revisao: !!alertaCfg.excessiva_requer_revisao,
      negativa_requer_revisao: !!alertaCfg.negativa_requer_revisao,
      overlap_requer_revisao: !!alertaCfg.overlap_requer_revisao,
      sem_checkout_requer_revisao: !!alertaCfg.sem_checkout_requer_revisao,
      atualizado_em: new Date().toISOString(),
    };
    let error: any = null;
    if (alertaCfg.id) {
      const res = await (supabase as any)
        .from("alertas_horas_config")
        .update(payload)
        .eq("id", alertaCfg.id);
      error = res.error;
    } else {
      const res = await (supabase as any)
        .from("alertas_horas_config")
        .insert(payload)
        .select()
        .single();
      error = res.error;
      if (res.data) setAlertaCfg(res.data);
    }
    setSavingAlertaCfg(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Limites de alerta atualizados!");
  };

  return (
    <div className="space-y-6">
      {/* Groups section */}
      <Card>
        <CardHeader className="py-4 px-5">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Grupos de Clientes
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          {/* Add group */}
          <div className="flex gap-2">
            <Input
              placeholder="Nome do grupo..."
              value={newGrupoNome}
              onChange={(e) => setNewGrupoNome(e.target.value)}
              className="max-w-xs"
              onKeyDown={(e) => e.key === "Enter" && handleAddGrupo()}
            />
            <Button size="sm" onClick={handleAddGrupo} disabled={addingGrupo}>
              {addingGrupo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Criar Grupo
            </Button>
          </div>

          {/* List groups */}
          {grupos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum grupo criado</p>
          ) : (
            <div className="space-y-3">
              {grupos.map((g: any) => {
                const gMembros = membros.filter((m: any) => m.grupo_id === g.id);
                return (
                  <div key={g.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">{g.nome}</h4>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{gMembros.length} clientes</Badge>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteGrupo(g.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    {/* Add member */}
                    <div className="flex gap-2">
                      <Select value={selectedGrupo === g.id ? newMembroCliente : ""} onValueChange={(v) => { setSelectedGrupo(g.id); setNewMembroCliente(v); }}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Adicionar cliente..." />
                        </SelectTrigger>
                        <SelectContent>
                          {allClientes
                            .filter((c) => !gMembros.some((m: any) => m.cliente_nome === c))
                            .map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => { setSelectedGrupo(g.id); handleAddMembro(); }}
                        disabled={selectedGrupo !== g.id || !newMembroCliente}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Members */}
                    {gMembros.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {gMembros.map((m: any) => (
                          <Badge key={m.id} variant="outline" className="gap-1 text-xs">
                            {m.cliente_nome}
                            <button onClick={() => handleDeleteMembro(m.id)} className="ml-0.5 hover:text-destructive">×</button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Valor hora section */}
      <Card>
        <CardHeader className="py-4 px-5">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Valor da Hora por Técnico
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          {/* Add valor hora */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Técnico</Label>
              <Select value={vhTecnico} onValueChange={setVhTecnico}>
                <SelectTrigger className="w-[160px] h-9 text-xs">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {allTecnicos.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Referência</Label>
              <Select value={vhTipoRef} onValueChange={setVhTipoRef}>
                <SelectTrigger className="w-[120px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cliente">Cliente</SelectItem>
                  <SelectItem value="grupo">Grupo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {vhTipoRef === "cliente" ? (
              <div className="space-y-1">
                <Label className="text-xs">Cliente</Label>
                <Select value={vhRefNome} onValueChange={setVhRefNome}>
                  <SelectTrigger className="w-[180px] h-9 text-xs">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allClientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Grupo</Label>
                <Select value={vhGrupoId} onValueChange={setVhGrupoId}>
                  <SelectTrigger className="w-[160px] h-9 text-xs">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {grupos.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">R$/hora</Label>
              <Input
                type="number"
                value={vhValor}
                onChange={(e) => setVhValor(e.target.value)}
                placeholder="0.00"
                className="w-[100px] h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">R$/hora FDS</Label>
              <Input
                type="number"
                value={vhValorFds}
                onChange={(e) => setVhValorFds(e.target.value)}
                placeholder="opcional"
                className="w-[100px] h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Aplica taxa emerg.</Label>
              <div className="h-9 flex items-center">
                <Switch checked={vhAplicaEmerg} onCheckedChange={setVhAplicaEmerg} />
              </div>
            </div>
            {vhAplicaEmerg && (
              <div className="space-y-1">
                <Label className="text-xs">Taxa fixa emerg. (R$)</Label>
                <Input
                  type="number"
                  value={vhTaxaEmerg}
                  onChange={(e) => setVhTaxaEmerg(e.target.value)}
                  placeholder="0.00"
                  className="w-[110px] h-9 text-xs"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs" title="IDs de tipo de tarefa do Auvo, separados por vírgula">
                IDs taskType emerg.
              </Label>
              <Input
                type="text"
                value={vhTaskTypesEmerg}
                onChange={(e) => setVhTaskTypesEmerg(e.target.value)}
                placeholder="ex.: 201522,201523"
                className="w-[160px] h-9 text-xs"
              />
            </div>
            <Button size="sm" onClick={handleAddValorHora} disabled={addingVH}>
              {addingVH ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Adicionar
            </Button>
          </div>

          {/* List */}
          {valorHoraConfigs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum valor/hora cadastrado</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Técnico</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead className="text-right">R$/hora</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {valorHoraConfigs.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-sm">{c.tecnico_nome}</TableCell>
                    <TableCell>
                      <Badge variant={c.tipo_referencia === "grupo" ? "default" : "secondary"} className="text-[10px]">
                        {c.tipo_referencia === "grupo" ? "Grupo" : "Cliente"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{c.referencia_nome}</TableCell>
                    <TableCell className="text-right font-semibold text-sm">
                      {Number(c.valor_hora).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteVH(c.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Limites de Alerta de Horas */}
      <Card>
        <CardHeader className="py-4 px-5">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Limites de Alerta de Horas
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Limites usados pelo tab "Horas Trabalhadas" para sinalizar OS suspeitas.
            Não afetam o cálculo de valor — são apenas alertas visuais.
          </p>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">OS curta — alerta amarelo abaixo de (min)</Label>
              <Input
                type="number"
                value={alertaCfg.limite_minimo_minutos ?? ""}
                onChange={(e) => setAlertaCfg({ ...alertaCfg, limite_minimo_minutos: e.target.value })}
                className="w-[140px] h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">OS longa — alerta azul acima de (h)</Label>
              <Input
                type="number"
                value={alertaCfg.limite_maximo_horas ?? ""}
                onChange={(e) => setAlertaCfg({ ...alertaCfg, limite_maximo_horas: e.target.value })}
                className="w-[140px] h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">OS excessiva — alerta vermelho acima de (h)</Label>
              <Input
                type="number"
                value={alertaCfg.limite_excessivo_horas ?? ""}
                onChange={(e) => setAlertaCfg({ ...alertaCfg, limite_excessivo_horas: e.target.value })}
                className="w-[140px] h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Detectar sobreposição por técnico</Label>
              <div className="h-9 flex items-center">
                <Switch
                  checked={!!alertaCfg.detectar_overlap_tecnico}
                  onCheckedChange={(v) => setAlertaCfg({ ...alertaCfg, detectar_overlap_tecnico: v })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sinalizar duração negativa</Label>
              <div className="h-9 flex items-center">
                <Switch
                  checked={!!alertaCfg.detectar_horas_negativas}
                  onCheckedChange={(v) => setAlertaCfg({ ...alertaCfg, detectar_horas_negativas: v })}
                />
              </div>
            </div>
            <Button size="sm" onClick={handleSaveAlertaCfg} disabled={savingAlertaCfg}>
              {savingAlertaCfg ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </div>

          {/* Toggles "requer revisão antes de faturar" */}
          <div className="border-t pt-4 mt-2 space-y-3">
            <div>
              <h4 className="text-sm font-semibold">Requer revisão antes de faturar?</h4>
              <p className="text-xs text-muted-foreground">
                Quando ligado, OS com este alerta ficam bloqueadas do total faturável até alguém aprovar manualmente na "Caixa de Revisão".
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { key: "curta_requer_revisao", label: "OS curta" },
                { key: "longa_requer_revisao", label: "OS longa" },
                { key: "excessiva_requer_revisao", label: "OS excessiva" },
                { key: "negativa_requer_revisao", label: "Duração negativa" },
                { key: "overlap_requer_revisao", label: "Sobreposição de horários" },
                { key: "sem_checkout_requer_revisao", label: "Sem checkout (com horas)" },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between border rounded-md px-3 py-2">
                  <Label className="text-xs cursor-pointer" htmlFor={`req-${key}`}>{label}</Label>
                  <Switch
                    id={`req-${key}`}
                    checked={!!alertaCfg[key]}
                    onCheckedChange={(v) => setAlertaCfg({ ...alertaCfg, [key]: v })}
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
