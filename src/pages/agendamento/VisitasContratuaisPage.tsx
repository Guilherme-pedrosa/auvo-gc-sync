import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  addMinutesToClock,
  buildContractVisitForecasts,
  isFieldTechnician,
} from "@/lib/contractVisits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Contract = Database["public"]["Tables"]["contratos"]["Row"];
type VisitConfig = Database["public"]["Tables"]["contratos_visitas_config"]["Row"];
type ContractForecast = Database["public"]["Tables"]["agenda_agendamentos"]["Row"];
type Technician = Pick<
  Database["public"]["Tables"]["rh_colaboradores"]["Row"],
  "id" | "nome" | "cargo" | "funcao" | "ativo"
>;

type VisitConfigDraft = {
  id?: string;
  contrato_id: string;
  qtd_visitas: number;
  qtd_tecnicos: number;
  duracao_minutos: number;
  hora_inicio: string;
  tecnico_ids: string[];
  dias_semana: number[];
  observacao: string;
  ativo: boolean;
};

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
] as const;

function currentCompetence(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function moveCompetence(value: string, months: number): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function competenceRange(value: string): { start: string; end: string; firstDay: string } {
  const [year, month] = value.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return { start: `${prefix}-01`, end: `${prefix}-${String(lastDay).padStart(2, "0")}`, firstDay: `${prefix}-01` };
}

function competenceLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1));
}

function dateLabel(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours ? `${hours}h` : ""}${rest ? `${String(rest).padStart(2, "0")}min` : ""}` || "0min";
}

function emptyDraft(contractId = ""): VisitConfigDraft {
  return {
    contrato_id: contractId,
    qtd_visitas: 1,
    qtd_tecnicos: 1,
    duracao_minutos: 120,
    hora_inicio: "08:00",
    tecnico_ids: [],
    dias_semana: [1, 2, 3, 4, 5],
    observacao: "",
    ativo: true,
  };
}

function configDraft(config: VisitConfig): VisitConfigDraft {
  return {
    id: config.id,
    contrato_id: config.contrato_id,
    qtd_visitas: config.qtd_visitas,
    qtd_tecnicos: config.qtd_tecnicos,
    duracao_minutos: config.duracao_minutos,
    hora_inicio: config.hora_inicio.slice(0, 5),
    tecnico_ids: config.tecnico_ids || [],
    dias_semana: config.dias_semana || [1, 2, 3, 4, 5],
    observacao: config.observacao || "",
    ativo: config.ativo,
  };
}

export default function VisitasContratuaisPage() {
  const queryClient = useQueryClient();
  const [competence, setCompetence] = useState(currentCompetence);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<VisitConfigDraft>(emptyDraft());
  const range = competenceRange(competence);

  const contractsQuery = useQuery({
    queryKey: ["contractual-visits", "contracts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos").select("*").eq("ativo", true).order("nome");
      if (error) throw error;
      return data as Contract[];
    },
  });

  const configsQuery = useQuery({
    queryKey: ["contractual-visits", "configs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contratos_visitas_config").select("*").order("atualizado_em");
      if (error) throw error;
      return data as VisitConfig[];
    },
  });

  const techniciansQuery = useQuery({
    queryKey: ["contractual-visits", "technicians"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rh_colaboradores")
        .select("id, nome, cargo, funcao, ativo")
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      const rows = data as Technician[];
      const field = rows.filter(isFieldTechnician);
      return field.length ? field : rows;
    },
  });

  const groupsQuery = useQuery({
    queryKey: ["contractual-visits", "groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("grupos_clientes").select("id, nome").order("nome");
      if (error) throw error;
      return data || [];
    },
  });

  const forecastsQuery = useQuery({
    queryKey: ["contractual-visits", "forecasts", competence],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agenda_agendamentos")
        .select("*")
        .eq("origem", "CONTRATO")
        .gte("data", range.start)
        .lte("data", range.end)
        .order("data")
        .order("hora_inicio");
      if (error) throw error;
      return data as ContractForecast[];
    },
  });

  const contracts = contractsQuery.data || [];
  const configs = configsQuery.data || [];
  const technicians = techniciansQuery.data || [];
  const forecasts = forecastsQuery.data || [];
  const configByContract = useMemo(() => new Map(configs.map((config) => [config.contrato_id, config])), [configs]);
  const contractById = useMemo(() => new Map(contracts.map((contract) => [contract.id, contract])), [contracts]);
  const technicianById = useMemo(() => new Map(technicians.map((technician) => [technician.id, technician])), [technicians]);
  const groupById = useMemo(() => new Map((groupsQuery.data || []).map((group) => [group.id, group.nome])), [groupsQuery.data]);

  const forecastsByConfig = useMemo(() => {
    const result = new Map<string, Map<number, ContractForecast[]>>();
    for (const forecast of forecasts) {
      if (!forecast.contrato_visita_config_id || !forecast.contrato_visita_numero) continue;
      const visits = result.get(forecast.contrato_visita_config_id) || new Map<number, ContractForecast[]>();
      const rows = visits.get(forecast.contrato_visita_numero) || [];
      rows.push(forecast);
      visits.set(forecast.contrato_visita_numero, rows);
      result.set(forecast.contrato_visita_config_id, visits);
    }
    return result;
  }, [forecasts]);

  const saveConfig = useMutation({
    mutationFn: async (value: VisitConfigDraft) => {
      if (!value.contrato_id) throw new Error("Selecione o contrato.");
      if (value.qtd_visitas < 1 || value.qtd_visitas > 31) throw new Error("Informe de 1 a 31 visitas por mês.");
      if (value.qtd_tecnicos < 1 || value.qtd_tecnicos > 10) throw new Error("Quantidade de técnicos inválida.");
      if (value.tecnico_ids.length < value.qtd_tecnicos) {
        throw new Error(`Selecione pelo menos ${value.qtd_tecnicos} técnico(s).`);
      }
      if (value.duracao_minutos < 15) throw new Error("A duração mínima é de 15 minutos.");
      if (!value.dias_semana.length) throw new Error("Selecione pelo menos um dia da semana.");
      addMinutesToClock(value.hora_inicio, value.duracao_minutos);
      const { data: authData } = await supabase.auth.getUser();
      const payload: Database["public"]["Tables"]["contratos_visitas_config"]["Insert"] = {
        contrato_id: value.contrato_id,
        qtd_visitas: value.qtd_visitas,
        qtd_tecnicos: value.qtd_tecnicos,
        duracao_minutos: value.duracao_minutos,
        hora_inicio: value.hora_inicio,
        tecnico_ids: value.tecnico_ids,
        dias_semana: value.dias_semana,
        observacao: value.observacao.trim() || null,
        ativo: value.ativo,
        criado_por: authData.user?.id || null,
      };
      const response = value.id
        ? await supabase.from("contratos_visitas_config").update(payload).eq("id", value.id)
        : await supabase.from("contratos_visitas_config").insert(payload);
      if (response.error) throw response.error;
    },
    onSuccess: () => {
      toast.success("Configuração contratual salva.");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["contractual-visits", "configs"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const generateForecasts = useMutation({
    mutationFn: async (configIds?: string[]) => {
      const selected = configs.filter((config) => config.ativo && (!configIds || configIds.includes(config.id)));
      if (!selected.length) throw new Error("Nenhuma configuração ativa para gerar.");
      const { data: authData } = await supabase.auth.getUser();
      const rows: Database["public"]["Tables"]["agenda_agendamentos"]["Insert"][] = [];
      const errors: string[] = [];
      let skipped = 0;

      for (const config of selected) {
        const contract = contractById.get(config.contrato_id);
        if (!contract) {
          errors.push("Contrato não encontrado para uma configuração.");
          continue;
        }
        try {
          const plan = buildContractVisitForecasts({
            competencia: competence,
            qtdVisitas: config.qtd_visitas,
            qtdTecnicos: config.qtd_tecnicos,
            duracaoMinutos: config.duracao_minutos,
            horaInicio: config.hora_inicio,
            tecnicoIds: config.tecnico_ids.filter((id) => technicianById.has(id)),
            diasSemana: config.dias_semana,
            vigenciaInicio: contract.vigencia_inicio,
            vigenciaFim: contract.vigencia_fim,
          });
          const target = contract.cliente_nome || (contract.grupo_id ? groupById.get(contract.grupo_id) : null) || contract.nome;
          const existing = forecastsByConfig.get(config.id) || new Map<number, ContractForecast[]>();

          for (const visit of plan) {
            const existingTechnicians = new Set((existing.get(visit.visitaNumero) || []).map((row) => row.colaborador_id));
            for (const technicianId of visit.tecnicoIds) {
              if (existingTechnicians.has(technicianId)) {
                skipped += 1;
                continue;
              }
              const technician = technicianById.get(technicianId);
              if (!technician) continue;
              rows.push({
                data: visit.data,
                hora_inicio: `${visit.horaInicio}:00`,
                hora_fim: `${visit.horaFim}:00`,
                colaborador_id: technician.id,
                colaborador_nome: technician.nome,
                cliente: target.toLocaleUpperCase("pt-BR"),
                descricao: `Visita contratual ${visit.visitaNumero}/${config.qtd_visitas} · ${contract.nome}`,
                status: "PREVISAO_CONTRATUAL",
                origem: "CONTRATO",
                auvo_task_id: null,
                gc_os_codigo: null,
                gc_orcamento_codigo: null,
                previsao_continuidade: true,
                previsao_detalhes: config.observacao?.trim()
                  ? `Contrato ${contract.nome} · ${config.observacao.trim()}`
                  : `Contrato ${contract.nome}`,
                contrato_id: contract.id,
                contrato_visita_config_id: config.id,
                contrato_visita_competencia: range.firstDay,
                contrato_visita_numero: visit.visitaNumero,
                criado_por: authData.user?.id || null,
              });
            }
          }
        } catch (error) {
          errors.push(`${contract.nome}: ${(error as Error).message}`);
        }
      }

      if (rows.length) {
        const { error } = await supabase.from("agenda_agendamentos").insert(rows);
        if (error) throw error;
      }
      return { inserted: rows.length, skipped, errors };
    },
    onSuccess: ({ inserted, skipped, errors }) => {
      if (inserted) toast.success(`${inserted} previsão(ões) adicionada(s) ao Agendamento Equipe.`);
      else if (skipped) toast.info("As previsões deste mês já estavam geradas.");
      if (errors.length) toast.warning(errors.slice(0, 3).join(" | "));
      void queryClient.invalidateQueries({ queryKey: ["contractual-visits", "forecasts"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const clearMonth = useMutation({
    mutationFn: async (configId: string) => {
      const { error } = await supabase
        .from("agenda_agendamentos")
        .delete()
        .eq("origem", "CONTRATO")
        .eq("contrato_visita_config_id", configId)
        .eq("contrato_visita_competencia", range.firstDay);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Previsões contratuais do mês removidas.");
      void queryClient.invalidateQueries({ queryKey: ["contractual-visits", "forecasts"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteConfig = useMutation({
    mutationFn: async (configId: string) => {
      const { error } = await supabase.from("contratos_visitas_config").delete().eq("id", configId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configuração e previsões vinculadas removidas.");
      void queryClient.invalidateQueries({ queryKey: ["contractual-visits"] });
      void queryClient.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const loading = contractsQuery.isLoading || configsQuery.isLoading || techniciansQuery.isLoading || forecastsQuery.isLoading;
  const configuredCount = contracts.filter((contract) => configByContract.has(contract.id)).length;

  return (
    <div className="h-full overflow-auto bg-background p-4 md:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Visitas Contratuais</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Planeje as visitas dos contratos como previsões internas. Nada é enviado ao Auvo ou ao GestãoClick.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCompetence((value) => moveCompetence(value, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input type="month" value={competence} onChange={(event) => setCompetence(event.target.value)} className="w-[170px]" />
            <Button variant="outline" size="icon" onClick={() => setCompetence((value) => moveCompetence(value, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => generateForecasts.mutate(undefined)}
              disabled={generateForecasts.isPending || configuredCount === 0}
            >
              {generateForecasts.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Gerar previsões de {competenceLabel(competence)}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="flex items-center gap-3 p-4"><CalendarDays className="h-5 w-5 text-primary" /><div><p className="text-xs text-muted-foreground">Contratos ativos</p><p className="text-xl font-bold">{contracts.length}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><Users className="h-5 w-5 text-primary" /><div><p className="text-xs text-muted-foreground">Configurados</p><p className="text-xl font-bold">{configuredCount}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><Clock3 className="h-5 w-5 text-primary" /><div><p className="text-xs text-muted-foreground">Linhas previstas no mês</p><p className="text-xl font-bold">{forecasts.length}</p></div></CardContent></Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Contratos e previsão mensal</CardTitle>
            <Button variant="outline" size="sm" onClick={() => { setDraft(emptyDraft()); setDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Nova configuração
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : contracts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum contrato ativo cadastrado.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead>Configuração</TableHead>
                      <TableHead>Equipe habilitada</TableHead>
                      <TableHead>Previsões em {competenceLabel(competence)}</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contracts.map((contract) => {
                      const config = configByContract.get(contract.id);
                      const visits = config ? forecastsByConfig.get(config.id) : undefined;
                      return (
                        <TableRow key={contract.id} className="align-top">
                          <TableCell className="min-w-[230px]">
                            <p className="font-semibold">{contract.nome}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {contract.cliente_nome || (contract.grupo_id ? `Grupo: ${groupById.get(contract.grupo_id) || "não localizado"}` : "Sem cliente vinculado")}
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">Vigência: {contract.vigencia_inicio ? dateLabel(contract.vigencia_inicio) : "sem início"} → {contract.vigencia_fim ? dateLabel(contract.vigencia_fim) : "sem fim"}</p>
                          </TableCell>
                          <TableCell className="min-w-[220px]">
                            {config ? (
                              <div className="space-y-1 text-xs">
                                <div className="flex flex-wrap gap-1">
                                  <Badge variant={config.ativo ? "default" : "secondary"}>{config.ativo ? "Ativa" : "Pausada"}</Badge>
                                  <Badge variant="outline">{config.qtd_visitas} visita(s)/mês</Badge>
                                </div>
                                <p>{config.qtd_tecnicos} técnico(s) · {durationLabel(config.duracao_minutos)} · início {config.hora_inicio.slice(0, 5)}</p>
                                <p className="text-muted-foreground">{WEEKDAYS.filter((day) => config.dias_semana.includes(day.value)).map((day) => day.label).join(", ")}</p>
                              </div>
                            ) : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">Não configurado</Badge>}
                          </TableCell>
                          <TableCell className="min-w-[200px] text-xs">
                            {config ? config.tecnico_ids.map((id) => technicianById.get(id)?.nome).filter(Boolean).join(" · ") || "Equipe não localizada" : "—"}
                          </TableCell>
                          <TableCell className="min-w-[290px]">
                            {visits && visits.size ? (
                              <div className="space-y-1.5">
                                {[...visits.entries()].sort(([a], [b]) => a - b).map(([number, rows]) => (
                                  <div key={number} className="rounded border bg-muted/30 px-2 py-1 text-xs">
                                    <span className="font-semibold">Visita {number}</span> · {dateLabel(rows[0].data)} · {rows[0].hora_inicio.slice(0, 5)}–{rows[0].hora_fim.slice(0, 5)}
                                    <p className="truncate text-[11px] text-muted-foreground">{rows.map((row) => row.colaborador_nome).join(" + ")}</p>
                                  </div>
                                ))}
                              </div>
                            ) : <span className="text-xs text-muted-foreground">Ainda não gerada para este mês.</span>}
                          </TableCell>
                          <TableCell className="min-w-[180px] text-right">
                            <div className="flex justify-end gap-1">
                              {config ? (
                                <>
                                  <Button variant="outline" size="sm" onClick={() => generateForecasts.mutate([config.id])} disabled={!config.ativo || generateForecasts.isPending}>Gerar</Button>
                                  <Button variant="ghost" size="icon" title="Editar configuração" onClick={() => { setDraft(configDraft(config)); setDialogOpen(true); }}><Edit className="h-4 w-4" /></Button>
                                  {visits?.size ? (
                                    <Button variant="ghost" size="icon" title="Remover previsões deste mês" onClick={() => { if (confirm(`Remover somente as previsões de ${competenceLabel(competence)}?`)) clearMonth.mutate(config.id); }}><RotateCcw className="h-4 w-4" /></Button>
                                  ) : null}
                                  <Button variant="ghost" size="icon" className="text-destructive" title="Excluir configuração" onClick={() => { if (confirm("Excluir a configuração e todas as previsões contratuais vinculadas?")) deleteConfig.mutate(config.id); }}><Trash2 className="h-4 w-4" /></Button>
                                </>
                              ) : (
                                <Button size="sm" onClick={() => { setDraft(emptyDraft(contract.id)); setDialogOpen(true); }}>Configurar</Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Editar previsão contratual" : "Configurar visitas contratuais"}</DialogTitle>
            <DialogDescription>Esta configuração gera somente previsões internas no Agendamento Equipe.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="space-y-2">
              <Label>Contrato</Label>
              <select
                value={draft.contrato_id}
                disabled={Boolean(draft.id)}
                onChange={(event) => setDraft((current) => ({ ...current, contrato_id: event.target.value }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                <option value="">Selecione o contrato</option>
                {contracts.filter((contract) => !configByContract.has(contract.id) || contract.id === draft.contrato_id).map((contract) => (
                  <option key={contract.id} value={contract.id}>{contract.nome}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2"><Label>Visitas/mês</Label><Input type="number" min={1} max={31} value={draft.qtd_visitas} onChange={(event) => setDraft((current) => ({ ...current, qtd_visitas: Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label>Técnicos/visita</Label><Input type="number" min={1} max={10} value={draft.qtd_tecnicos} onChange={(event) => setDraft((current) => ({ ...current, qtd_tecnicos: Number(event.target.value) }))} /></div>
              <div className="space-y-2"><Label>Duração (min)</Label><Input type="number" min={15} max={1440} step={15} value={draft.duracao_minutos} onChange={(event) => setDraft((current) => ({ ...current, duracao_minutos: Number(event.target.value) }))} /><p className="text-[10px] text-muted-foreground">{durationLabel(draft.duracao_minutos)}</p></div>
              <div className="space-y-2"><Label>Horário inicial</Label><Input type="time" value={draft.hora_inicio} onChange={(event) => setDraft((current) => ({ ...current, hora_inicio: event.target.value }))} /></div>
            </div>

            <div className="space-y-2">
              <Label>Dias permitidos</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => (
                  <label key={day.value} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox checked={draft.dias_semana.includes(day.value)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, dias_semana: checked ? [...current.dias_semana, day.value].sort() : current.dias_semana.filter((value) => value !== day.value) }))} />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between"><Label>Equipe habilitada do RH</Label><span className="text-xs text-muted-foreground">{draft.tecnico_ids.length} selecionado(s)</span></div>
              <div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
                {technicians.map((technician) => (
                  <label key={technician.id} className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-muted">
                    <Checkbox checked={draft.tecnico_ids.includes(technician.id)} onCheckedChange={(checked) => setDraft((current) => ({ ...current, tecnico_ids: checked ? [...current.tecnico_ids, technician.id] : current.tecnico_ids.filter((id) => id !== technician.id) }))} />
                    <span className="text-sm"><span className="block font-medium leading-tight">{technician.nome}</span><span className="text-[11px] text-muted-foreground">{technician.cargo || technician.funcao || "Sem cargo"}</span></span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2"><Label>Detalhes da previsão</Label><textarea value={draft.observacao} onChange={(event) => setDraft((current) => ({ ...current, observacao: event.target.value }))} placeholder="Ex.: levar kit de preventiva, combinar acesso à casa de máquinas..." className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>
            <div className="flex items-center justify-between rounded-md border p-3"><div><p className="text-sm font-medium">Configuração ativa</p><p className="text-xs text-muted-foreground">Configurações pausadas não geram novas previsões.</p></div><Switch checked={draft.ativo} onCheckedChange={(checked) => setDraft((current) => ({ ...current, ativo: checked }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveConfig.mutate(draft)} disabled={saveConfig.isPending}>{saveConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar configuração</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
