import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Users, DollarSign, Loader2 } from "lucide-react";

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

  // Valor hora CRUD
  const [vhTecnico, setVhTecnico] = useState("");
  const [vhTipoRef, setVhTipoRef] = useState("cliente");
  const [vhRefNome, setVhRefNome] = useState("");
  const [vhGrupoId, setVhGrupoId] = useState("");
  const [vhValor, setVhValor] = useState("");
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
    };

    const { error } = await supabase.from("valor_hora_config").insert(insert);
    setAddingVH(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Valor/hora cadastrado!");
    setVhValor("");
    onRefresh();
  };

  const handleDeleteVH = async (id: string) => {
    await supabase.from("valor_hora_config").delete().eq("id", id);
    toast.success("Removido");
    onRefresh();
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
    </div>
  );
}
