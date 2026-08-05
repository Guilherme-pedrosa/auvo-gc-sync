import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-integration-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPEN_OS_SITUATIONS = [
  { id: '7063579', label: 'AGUARDANDO COMPRA DE PEÇAS' },
  { id: '7063580', label: 'AGUARDANDO CHEGADA DE PEÇAS' },
  { id: '7659440', label: 'AGUARDANDO FABRICAÇÃO' },
  { id: '7063581', label: 'PEDIDO EM CONFERÊNCIA' },
  { id: '7063705', label: 'PEDIDO CONFERIDO AGUARDANDO EXECUÇÃO' },
  { id: '7213493', label: 'SERVIÇO AGUARDANDO EXECUÇÃO' },
  { id: '7684665', label: 'RETIRADA PELO TÉCNICO' },
  { id: '7748831', label: 'AGUARDANDO RETIRADA' },
  { id: '8219136', label: 'EM ROTA' },
  { id: '7116099', label: 'EXECUTADO – AG. NEGOCIAÇÃO' },
] as const;

const OPEN_IDS = new Set(OPEN_OS_SITUATIONS.map((item) => item.id));
const OPEN_LABELS = new Set(OPEN_OS_SITUATIONS.map((item) => normalize(item.label)));
const PAGE_SIZE = 1000;
const COLUMNS = [
  'mirror_key', 'auvo_task_id', 'cliente', 'tecnico', 'tecnico_id', 'data_tarefa',
  'status_auvo', 'orientacao', 'endereco', 'hora_inicio', 'hora_fim', 'auvo_link',
  'equipamento_nome', 'equipamento_id_serie', 'gc_os_id', 'gc_os_codigo', 'gc_os_cliente',
  'gc_os_situacao', 'gc_os_situacao_id', 'gc_os_cor_situacao', 'gc_os_valor_total',
  'gc_os_vendedor', 'gc_os_data', 'gc_os_data_saida', 'gc_os_link', 'gc_os_tarefa_exec',
  'gc_os_tarefa_os', 'atualizado_em',
].join(',');

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function parseTaskIds(value: unknown): string[] {
  return Array.from(new Set(
    String(value ?? '')
      .split(/[\/,;\s]+/)
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id)),
  ));
}

function isOpenOs(row: any): boolean {
  const id = String(row?.gc_os_situacao_id || '').trim();
  if (id) return OPEN_IDS.has(id);
  return OPEN_LABELS.has(normalize(row?.gc_os_situacao));
}

function safeEquals(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index] ^ b[index];
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Credenciais internas do Sync GC não configuradas');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function fetchAllCentralRows(): Promise<any[]> {
  const client = adminClient();
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('tarefas_central')
      .select(COLUMNS)
      .order('atualizado_em', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function completeness(row: any): number {
  return (
    (String(row?.auvo_task_id || '').startsWith('gc-only::') ? 0 : 10)
    + (parseTaskIds(row?.gc_os_tarefa_exec).length ? 8 : 0)
    + (parseTaskIds(row?.gc_os_tarefa_os).length ? 4 : 0)
    + (row?.gc_os_cliente ? 2 : 0)
    + (row?.equipamento_nome ? 1 : 0)
  );
}

function taskView(row: any, taskId?: string) {
  if (!row) return null;
  return {
    task_id: String(taskId || row.auvo_task_id || ''),
    customer_name: row.cliente || null,
    technician_name: row.tecnico || null,
    technician_id: row.tecnico_id || null,
    task_date: row.data_tarefa || null,
    start_time: row.hora_inicio || null,
    end_time: row.hora_fim || null,
    status: row.status_auvo || null,
    orientation: row.orientacao || null,
    address: row.endereco || null,
    auvo_link: row.auvo_link || null,
  };
}

function buildResponse(rows: any[], startDate: string, endDate: string) {
  const taskById = new Map<string, any>();
  for (const row of rows) {
    const taskId = String(row?.auvo_task_id || '').trim();
    if (taskId && /^\d+$/.test(taskId) && !taskById.has(taskId)) taskById.set(taskId, row);
  }

  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const osId = String(row?.gc_os_id || '').trim();
    if (!osId || !isOpenOs(row)) continue;
    const group = groups.get(osId) || [];
    group.push(row);
    groups.set(osId, group);
  }

  const orders = Array.from(groups.entries()).map(([osId, group]) => {
    const sorted = [...group].sort((a, b) => {
      const score = completeness(b) - completeness(a);
      if (score !== 0) return score;
      return String(b.atualizado_em || '').localeCompare(String(a.atualizado_em || ''));
    });
    const base = sorted[0];
    const executionTaskIds = Array.from(new Set(group.flatMap((row) => parseTaskIds(row.gc_os_tarefa_exec))));
    const osTaskIds = Array.from(new Set(group.flatMap((row) => parseTaskIds(row.gc_os_tarefa_os))));
    const executionTasks = executionTaskIds
      .map((taskId) => taskView(taskById.get(taskId), taskId))
      .filter(Boolean);
    const osTask = osTaskIds.map((taskId) => taskById.get(taskId)).find(Boolean) || null;

    return {
      gc_os_id: osId,
      gc_os_code: String(base.gc_os_codigo || ''),
      client_name: base.gc_os_cliente || base.cliente || null,
      situation_id: base.gc_os_situacao_id || null,
      situation_name: base.gc_os_situacao || null,
      situation_color: base.gc_os_cor_situacao || null,
      total_value: Number(base.gc_os_valor_total || 0),
      seller_name: base.gc_os_vendedor || null,
      os_technician_name: osTask?.tecnico || null,
      os_date: base.gc_os_data || null,
      expected_exit_date: base.gc_os_data_saida || null,
      gc_link: base.gc_os_link || null,
      equipment_name: base.equipamento_nome || null,
      equipment_serial: base.equipamento_id_serie || null,
      os_task_ids: osTaskIds,
      execution_task_ids: executionTaskIds,
      execution_tasks: executionTasks,
      source_updated_at: base.atualizado_em || null,
    };
  }).sort((a, b) => String(b.gc_os_code).localeCompare(String(a.gc_os_code), 'pt-BR', { numeric: true }));

  const referencedExecutionIds = new Set(orders.flatMap((order) => order.execution_task_ids));
  const orphanTasks = rows
    .filter((row) => {
      const taskId = String(row?.auvo_task_id || '');
      const date = String(row?.data_tarefa || '');
      return /^\d+$/.test(taskId)
        && date >= startDate
        && date <= endDate
        && !row?.gc_os_id
        && !referencedExecutionIds.has(taskId);
    })
    .map((row) => taskView(row))
    .filter(Boolean);

  return { orders, orphan_tasks: orphanTasks };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const expectedKey = Deno.env.get('PICK_PACK_INTEGRATION_KEY') || '';
    const suppliedKey = req.headers.get('x-integration-key') || '';
    if (!expectedKey) return json({ error: 'PICK_PACK_INTEGRATION_KEY não configurada no Sync GC' }, 503);
    if (!suppliedKey || !safeEquals(expectedKey, suppliedKey)) return json({ error: 'Integração não autorizada' }, 401);

    const body = await req.json().catch(() => ({}));
    const startDate = String(body?.start_date || new Date().toISOString().slice(0, 10));
    const endDate = String(body?.end_date || startDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return json({ error: 'Datas devem usar YYYY-MM-DD' }, 400);
    }

    const rows = await fetchAllCentralRows();
    const result = buildResponse(rows, startDate, endDate);
    return json({
      ...result,
      source: 'syncgc.controle-os',
      source_rows: rows.length,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error('[pick-pack-controle-os]', message);
    return json({ error: message }, 500);
  }
});
