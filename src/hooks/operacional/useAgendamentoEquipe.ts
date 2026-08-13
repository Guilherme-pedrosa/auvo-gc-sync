import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase as sb } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { resolveAgendaTaskType } from "@/lib/agendaTaskType";
import { agendaWorkSnapshotQuality } from "@/lib/agendaWorkedTime";

export interface AgendaVeiculo {
  id: string;
  nome: string;
  placa: string | null;
  modelo: string | null;
  ordem: number;
  ativo: boolean;
  marca?: string | null;
  status?: string | null;
  observacao?: string | null;
  tvh_vehicle_id?: string | null;
  sincronizado_em?: string | null;
}

export interface AgendaAgendamento {
  id: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  colaborador_id: string | null;
  colaborador_nome: string;
  veiculo_id: string | null;
  cliente: string;
  descricao: string | null;
  status: string;
  auvo_task_id?: string | null;
  origem?: string | null;
  gc_os_codigo?: string | null;
  gc_os_id?: string | null;
  gc_orcamento_codigo?: string | null;
  gc_orcamento_id?: string | null;

  contrato_id?: string | null;
  contrato_visita_config_id?: string | null;
  contrato_visita_competencia?: string | null;
  contrato_visita_numero?: number | null;
  previsao_continuidade?: boolean;
  previsao_tipo?: string | null;
  previsao_detalhes?: string | null;
  conversao_status?: string | null;
  conversao_erro?: string | null;
  conversao_tentada_em?: string | null;
  convertida_em?: string | null;
  gc_os_situacao?: string | null;
  gc_os_cliente?: string | null;
  status_auvo?: string | null;
  pausada?: boolean | null;
  check_in_iso?: string | null;
  check_out_iso?: string | null;
  tipo_tarefa_auvo?: string | null;
  tipo_tarefa_auvo_id?: string | null;
  tipo_tarefa_auvo_descricao?: string | null;
  duracao_decimal?: number | null;
  duracao_planejada_minutos?: number | null;
  atualizado_em?: string | null;
  vinculo_status?: string | null;
}

async function preencherDocumentosGc(agendamentos: AgendaAgendamento[]) {
  const taskIds = [...new Set(
    agendamentos
      .map((item) => String(item.auvo_task_id || "").trim())
      .filter(Boolean),
  )];
  if (taskIds.length === 0) return agendamentos;

  const documentosPorTarefa = new Map<string, {
    os: string | null;
    os_id: string | null;
    orcamento: string | null;
    orcamento_id: string | null;

    situacao: string | null;
    cliente_gc: string | null;
    status_auvo: string | null;
    check_in: string | null;
    check_out: string | null;
    tipo_id: string | null;
    tipo_descricao: string | null;
    tarefa_os: string | null;
    tarefa_execucao: string | null;
    vinculo_status: string | null;
  }>();
  const estadoPorTarefa = new Map<string, {
    status_auvo: string | null;
    check_in: string | null;
    check_out: string | null;
    atualizado_em: string | null;
  }>();
  const tempoPorTarefa = new Map<string, {
    check_in_iso: string | null;
    check_out_iso: string | null;
    duracao_decimal: number | null;
    atualizado_em: string | null;
  }>();
  const statusAuvoConfiavel = (value: string | null | undefined) => {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    return ["FINALIZ", "CONCLUI", "ANDAMENTO", "DESLOCAMENTO", "PAUSAD", "ABERTA", "AGENDAD"]
      .some((token) => normalized.includes(token));
  };
  const taskTypeDescriptionScore = (value: string | null | undefined) => {
    const description = String(value || "").trim();
    if (!description) return 0;
    const normalized = description.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/^Tipo\s+\d+$/i.test(normalized) || /TIPO\s+NAO\s+INFORMADO/i.test(normalized)) return 1;
    return 10;
  };
  const preferTaskTypeDescription = (
    current: string | null | undefined,
    candidate: string | null | undefined,
  ) => taskTypeDescriptionScore(candidate) > taskTypeDescriptionScore(current)
    ? candidate || null
    : current || candidate || null;
  for (let index = 0; index < taskIds.length; index += 500) {
    const { data, error } = await sb
      .from("tarefas_central")
      .select("auvo_task_id,gc_os_id,gc_os_codigo,gc_orcamento_id,gc_orcamento_codigo,gc_os_situacao,gc_os_cliente,gc_os_tarefa_os,gc_os_tarefa_exec,status_auvo,check_in_iso,check_out_iso,duracao_decimal,task_type_id,descricao,atualizado_em")
      .in("auvo_task_id", taskIds.slice(index, index + 500))
      .order("atualizado_em", { ascending: false });
    if (error) throw error;

    for (const row of data ?? []) {
      const taskId = String(row.auvo_task_id || "").trim();
      if (!taskId) continue;
      const tempoCandidato = {
        check_in_iso: row.check_in_iso || null,
        check_out_iso: row.check_out_iso || null,
        duracao_decimal: row.duracao_decimal == null ? null : Number(row.duracao_decimal),
        atualizado_em: row.atualizado_em || null,
      };
      const tempoAtual = tempoPorTarefa.get(taskId);
      const qualidadeCandidato = agendaWorkSnapshotQuality(tempoCandidato);
      const qualidadeAtual = tempoAtual ? agendaWorkSnapshotQuality(tempoAtual) : -1;
      if (
        !tempoAtual
        || qualidadeCandidato > qualidadeAtual
        || (
          qualidadeCandidato === qualidadeAtual
          && String(tempoCandidato.atualizado_em || "") > String(tempoAtual.atualizado_em || "")
        )
      ) {
        tempoPorTarefa.set(taskId, tempoCandidato);
      }
      const estadoAtual = estadoPorTarefa.get(taskId);
      const statusAtual = statusAuvoConfiavel(row.status_auvo) ? row.status_auvo : null;
      // A consulta vem do snapshot mais novo para o mais antigo. O estado Auvo
      // da linha mais recente é autoritativo; linhas antigas só podem preencher
      // campos que realmente vieram vazios, nunca ressuscitar um status antigo.
      if (!estadoAtual) {
        estadoPorTarefa.set(taskId, {
          status_auvo: statusAtual,
          check_in: row.check_in_iso || null,
          check_out: row.check_out_iso || null,
          atualizado_em: row.atualizado_em || null,
        });
      } else {
        estadoPorTarefa.set(taskId, {
          status_auvo: estadoAtual.status_auvo || statusAtual,
          check_in: estadoAtual.check_in || row.check_in_iso || null,
          check_out: estadoAtual.check_out || row.check_out_iso || null,
          atualizado_em: estadoAtual.atualizado_em || row.atualizado_em || null,
        });
      }
      const atual = documentosPorTarefa.get(taskId);
      // Busca vínculo de cliente baseado no ID GestãoClick para saber se já está inter-relacionado
      const gcId = (row as any).gc_os_id || (row as any).gc_orcamento_id;
      let vinculoStatus = (row as any).vinculo_status || null;
      
      if (!vinculoStatus && gcId) {
        const { data: rh } = await sb.from("rh_clientes").select("vinculo_status").eq("gc_cliente_id", gcId).maybeSingle();
        if (rh?.vinculo_status) vinculoStatus = rh.vinculo_status;
      }

      documentosPorTarefa.set(taskId, {
        os: atual?.os || (row as any).gc_os_codigo || null,
        os_id: atual?.os_id || (row as any).gc_os_id || null,
        orcamento: atual?.orcamento || (row as any).gc_orcamento_codigo || null,
        orcamento_id: atual?.orcamento_id || (row as any).gc_orcamento_id || null,

        situacao: atual?.situacao || (row as any).gc_os_situacao || null,
        cliente_gc: atual?.cliente_gc || (row as any).gc_os_cliente || null,
        status_auvo: atual?.status_auvo || (row as any).status_auvo || null,
        check_in: atual?.check_in || (row as any).check_in_iso || null,
        check_out: atual?.check_out || (row as any).check_out_iso || null,
        tipo_id: atual?.tipo_id || (row as any).task_type_id || null,
        tipo_descricao: preferTaskTypeDescription(atual?.tipo_descricao, (row as any).descricao),
        tarefa_os: atual?.tarefa_os || (row as any).gc_os_tarefa_os || null,
        tarefa_execucao: atual?.tarefa_execucao || (row as any).gc_os_tarefa_exec || null,
        vinculo_status: atual?.vinculo_status || vinculoStatus,
      });
    }
  }

  // A agenda normalmente contém a Tarefa Execução (atributo GC 73344), enquanto
  // auvo_task_id identifica a Tarefa OS (73343). Relaciona as duas antes de renderizar.
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from("tarefas_central")
      .select("auvo_task_id,gc_os_id,gc_os_codigo,gc_orcamento_id,gc_orcamento_codigo,gc_os_situacao,gc_os_cliente,gc_os_tarefa_exec,gc_os_tarefa_os")
      .not("gc_os_codigo", "is", null)
      .not("gc_os_tarefa_exec", "is", null)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    for (const row of data ?? []) {
      const idsExecucao = String(row.gc_os_tarefa_exec || "")
        .split("/")
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id) && taskIds.includes(id));
      for (const taskId of idsExecucao) {
        // O vínculo direto com 73343 tem precedência; 73344 só preenche o que falta.
        const atual = documentosPorTarefa.get(taskId);
        if (atual?.os) continue;
        
        // Busca vínculo de cliente baseado no ID GestãoClick para saber se já está inter-relacionado
        const gcId = (row as any).gc_os_id || (row as any).gc_orcamento_id;
        let vinculoStatus = (row as any).vinculo_status || null;
        
        if (!vinculoStatus && gcId) {
          const { data: rh } = await sb.from("rh_clientes").select("vinculo_status").eq("gc_cliente_id", gcId).maybeSingle();
          if (rh?.vinculo_status) vinculoStatus = rh.vinculo_status;
        }

        documentosPorTarefa.set(taskId, {
          os: (row as any).gc_os_codigo || null,
          os_id: (row as any).gc_os_id || null,
          orcamento: (row as any).gc_orcamento_codigo || null,
          orcamento_id: (row as any).gc_orcamento_id || null,

          situacao: (row as any).gc_os_situacao || null,
          cliente_gc: (row as any).gc_os_cliente || null,
          status_auvo: estadoPorTarefa.get(taskId)?.status_auvo || null,
          check_in: estadoPorTarefa.get(taskId)?.check_in || null,
          check_out: estadoPorTarefa.get(taskId)?.check_out || null,
          tipo_id: atual?.tipo_id || null,
          tipo_descricao: atual?.tipo_descricao || null,
          tarefa_os: atual?.tarefa_os || (row as any).gc_os_tarefa_os || (row as any).auvo_task_id || null,
          tarefa_execucao: atual?.tarefa_execucao || (row as any).gc_os_tarefa_exec || null,
          vinculo_status: atual?.vinculo_status || vinculoStatus,
        });
      }
    }

    if ((data ?? []).length < pageSize) break;
    offset += pageSize;
  }

  return agendamentos.map((item) => {
    const documento = documentosPorTarefa.get(String(item.auvo_task_id || "").trim());
    const estado = estadoPorTarefa.get(String(item.auvo_task_id || "").trim());
    const tempo = tempoPorTarefa.get(String(item.auvo_task_id || "").trim());
    if (!documento) return item;
    const tipoTarefa = resolveAgendaTaskType({
      taskId: item.auvo_task_id,
      taskTypeId: documento.tipo_id,
      taskTypeDescription: documento.tipo_descricao,
      gcOsTaskIds: documento.tarefa_os,
      gcExecutionTaskIds: documento.tarefa_execucao,
    });
    return {
      ...item,
      gc_os_codigo: documento.os || item.gc_os_codigo || null,
      gc_os_id: documento.os_id || item.gc_os_id || null,
      gc_orcamento_codigo: documento.orcamento || item.gc_orcamento_codigo || null,
      gc_orcamento_id: documento.orcamento_id || item.gc_orcamento_id || null,

      gc_os_situacao: documento.situacao || item.gc_os_situacao || null,
      gc_os_cliente: documento.cliente_gc || item.gc_os_cliente || null,
      status_auvo: estado?.status_auvo || documento.status_auvo || item.status_auvo || null,
      check_in_iso: tempo?.check_in_iso || estado?.check_in || documento.check_in || item.check_in_iso || null,
      check_out_iso: tempo?.check_out_iso || estado?.check_out || documento.check_out || item.check_out_iso || null,
      duracao_decimal: tempo?.duracao_decimal ?? item.duracao_decimal ?? null,
      tipo_tarefa_auvo: tipoTarefa,
      tipo_tarefa_auvo_id: documento.tipo_id,
      tipo_tarefa_auvo_descricao: documento.tipo_descricao,
      vinculo_status: documento.vinculo_status || item.vinculo_status || null,
    };
  });
}

export function useAgendaVeiculos() {
  return useQuery({
    queryKey: ["agenda_veiculos"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await sb
        .from("agenda_veiculos")
        .select("*")
        .eq("ativo", true)
        .is("deletado_em", null)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as AgendaVeiculo[];
    },
  });
}

export function useAgendamentos(dataISO: string) {
  return useQuery({
    queryKey: ["agenda_agendamentos", dataISO],
    queryFn: async () => {
      const { data, error } = await sb
        .from("agenda_agendamentos")
        .select("*")
        .eq("data", dataISO)
        .order("hora_inicio");
      if (error) throw error;
      return preencherDocumentosGc((data ?? []) as AgendaAgendamento[]);
    },
  });
}

export function useSaveAgendamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<AgendaAgendamento> & { id?: string }) => {
      // O usuário solicitou remover a validação de conflito de agenda, 
      // pois o Auvo permite tarefas sobrepostas.
      
      if (payload.id) {
        const { error } = await sb.from("agenda_agendamentos").update(payload).eq("id", payload.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("agenda_agendamentos").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.previsao_continuidade ? "Previsão salva" : "Agendamento salvo");
      qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
      qc.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteAgendamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("agenda_agendamentos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Agendamento excluído");
      qc.invalidateQueries({ queryKey: ["agenda_agendamentos"] });
      qc.invalidateQueries({ queryKey: ["agenda_semana"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/* ===================== Escala semanal (grade estilo planilha) ===================== */

export interface AgendaVeiculoDia {
  id: string;
  veiculo_id: string;
  data: string;
  texto: string;
}

export function useAgendaSemana(dias: string[]) {
  const inicio = dias[0];
  const fim = dias[dias.length - 1];
  return useQuery({
    queryKey: ["agenda_semana", inicio, fim],
    enabled: !!inicio && !!fim,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const [ag, vd] = await Promise.all([
        sb.from("agenda_agendamentos").select("*").gte("data", inicio).lte("data", fim),
        sb.from("agenda_veiculo_dia").select("*").gte("data", inicio).lte("data", fim),
      ]);
      if (ag.error) throw ag.error;
      if (vd.error) throw vd.error;
      return {
        agendamentos: await preencherDocumentosGc((ag.data ?? []) as AgendaAgendamento[]),
        veiculoDias: (vd.data ?? []) as AgendaVeiculoDia[],
      };
    },
  });
}

export function useSalvarCelulaTecnico() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      id?: string | null;
      data: string;
      colaborador_id: string;
      colaborador_nome: string;
      texto: string;
    }) => {
      const texto = p.texto.trim();
      if (p.id && !texto) {
        const { error } = await sb.from("agenda_agendamentos").delete().eq("id", p.id);
        if (error) throw error;
        return;
      }
      if (!texto) return;
      if (p.id) {
        const { error } = await sb
          .from("agenda_agendamentos")
          .update({ cliente: texto })
          .eq("id", p.id);
        if (error) throw error;
        return;
      }
      const { error } = await sb.from("agenda_agendamentos").insert({
        data: p.data,
        hora_inicio: "08:00",
        hora_fim: "18:00",
        colaborador_id: p.colaborador_id,
        colaborador_nome: p.colaborador_nome,
        cliente: texto,
        status: "AGENDADO",
      } as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_semana"] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSalvarCelulaVeiculo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { veiculo_id: string; data: string; texto: string }) => {
      const texto = p.texto.trim();
      if (!texto) {
        const { error } = await sb
          .from("agenda_veiculo_dia")
          .delete()
          .eq("veiculo_id", p.veiculo_id)
          .eq("data", p.data);
        if (error) throw error;
        return;
      }
      const { error } = await sb
        .from("agenda_veiculo_dia")
        .upsert({ veiculo_id: p.veiculo_id, data: p.data, texto }, { onConflict: "veiculo_id,data" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_semana"] }),
    onError: (e: Error) => toast.error(e.message),
  });
}
