import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Plus, Calendar, Clock, Users, Wrench, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";

interface ContratoVisitaConfig {
  id: string;
  contrato_id: string;
  qtd_visitas: number;
  qtd_tecnicos: number;
  duracao_estimada: string;
  tecnico_responsavel_id?: string;
  regra_agendamento: string;
  criado_em: string;
  atualizado_em: string;
}

export default function VisitasContratuaisPage() {
  const qc = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<Partial<ContratoVisitaConfig> | null>(null);

  const { data: contratos = [], isLoading: loadingContratos } = useQuery({
    queryKey: ["contratos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos").select("*").eq("ativo", true).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: configs = [], isLoading: loadingConfigs } = useQuery({
    queryKey: ["contratos_visitas_config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos_visitas_config").select("*");
      if (error) throw error;
      return data as ContratoVisitaConfig[];
    },
  });

  const { data: tecnicos = [] } = useQuery({
    queryKey: ["tecnicos_rh"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rh_colaboradores").select("id, nome").eq("ativo", true).order("nome");
      if (error) throw error;
      return data;
    },
  });

  const saveConfig = useMutation({
    mutationFn: async (payload: any) => {
      if (payload.id) {
        const { error } = await supabase.from("contratos_visitas_config").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("contratos_visitas_config").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contratos_visitas_config"] });
      toast.success("Configuração salva com sucesso");
      setIsDialogOpen(false);
      setEditingConfig(null);
    },
    onError: (error) => toast.error("Erro ao salvar: " + error.message),
  });

  const deleteConfig = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("contratos_visitas_config").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contratos_visitas_config"] });
      toast.success("Configuração removida");
    },
  });

  const getContratoNome = (id: string) => contratos.find(c => c.id === id)?.nome || "Contrato não encontrado";
  const getTecnicoNome = (id?: string) => tecnicos.find(t => t.id === id)?.nome || "Não definido";

  return (
    <div className="h-full overflow-auto p-6 space-y-6 bg-background">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Visitas Contratuais</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure e gerencie a recorrência de visitas técnicas baseadas em contratos ativos.
          </p>
        </div>
        <Button onClick={() => { setEditingConfig({}); setIsDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nova Configuração
        </Button>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Configurações Ativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingConfigs ? (
              <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : configs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                Nenhuma visita contratual configurada. Clique em "Nova Configuração" para começar.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Visitas/Mês</TableHead>
                      <TableHead>Técnicos</TableHead>
                      <TableHead>Duração</TableHead>
                      <TableHead>Responsável</TableHead>
                      <TableHead>Regra de Agendamento</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {configs.map((config) => (
                      <TableRow key={config.id}>
                        <TableCell className="font-medium">{getContratoNome(config.contrato_id)}</TableCell>
                        <TableCell>{config.qtd_visitas}</TableCell>
                        <TableCell>{config.qtd_tecnicos}</TableCell>
                        <TableCell>{config.duracao_estimada}</TableCell>
                        <TableCell>{getTecnicoNome(config.tecnico_responsavel_id)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-normal capitalize">
                            {config.regra_agendamento}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" onClick={() => { setEditingConfig(config); setIsDialogOpen(true); }}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => { if(confirm("Deseja excluir esta configuração?")) deleteConfig.mutate(config.id); }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingConfig?.id ? "Editar Configuração" : "Nova Configuração de Visita"}</DialogTitle>
            <DialogDescription>
              Defina os parâmetros de recorrência para este contrato. A IA utilizará estas regras para sugerir a agenda.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>Contrato</Label>
              <Select 
                value={editingConfig?.contrato_id} 
                onValueChange={(v) => setEditingConfig(prev => ({ ...prev, contrato_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o contrato" />
                </SelectTrigger>
                <SelectContent>
                  {contratos.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Técnico Responsável (Opcional)</Label>
              <Select 
                value={editingConfig?.tecnico_responsavel_id} 
                onValueChange={(v) => setEditingConfig(prev => ({ ...prev, tecnico_responsavel_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o técnico" />
                </SelectTrigger>
                <SelectContent>
                  {tecnicos.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Quantidade de Visitas p/ Mês</Label>
              <Input 
                type="number" 
                min="1" 
                value={editingConfig?.qtd_visitas || ""} 
                onChange={(e) => setEditingConfig(prev => ({ ...prev, qtd_visitas: parseInt(e.target.value) }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Técnicos por Visita</Label>
              <Input 
                type="number" 
                min="1" 
                value={editingConfig?.qtd_tecnicos || ""} 
                onChange={(e) => setEditingConfig(prev => ({ ...prev, qtd_tecnicos: parseInt(e.target.value) }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Duração Estimada (HH:mm)</Label>
              <Input 
                placeholder="Ex: 08:00" 
                value={editingConfig?.duracao_estimada || ""} 
                onChange={(e) => setEditingConfig(prev => ({ ...prev, duracao_estimada: e.target.value }))}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Regra de Agendamento (Frequência)</Label>
              <Input 
                placeholder="Ex: Primeira quarta-feira do mês / Todo dia 5 / 1ª e 3ª semana" 
                value={editingConfig?.regra_agendamento || ""} 
                onChange={(e) => setEditingConfig(prev => ({ ...prev, regra_agendamento: e.target.value }))}
              />
              <p className="text-[10px] text-muted-foreground mt-1 px-1 italic">
                A IA interpretará este texto para gerar as previsões na agenda técnica.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveConfig.mutate(editingConfig)} disabled={saveConfig.isPending}>
              {saveConfig.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar Configuração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
