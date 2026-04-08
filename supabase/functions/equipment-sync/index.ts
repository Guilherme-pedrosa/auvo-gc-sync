import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const TASK_PAGE_SIZE = 100;
const UPSERT_BATCH_SIZE = 500;

type EquipmentTaskLink = {
  taskId: string;
  equipmentIds: string[];
  taskType: string;
  taskTypeDescription: string;
  statusCode: number;
  taskDate: string | null;
  checkOutDate: string | null;
  customerDescription: string;
  userToName: string;
};

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Auvo login failed (${res.status})`);
  }

  const data = await res.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: no accessToken");
  return token;
}

function auvoHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const res = await fetch(url, options);

  if (res.status === 403 || res.status === 429) {
    console.log(`[equipment-sync] Rate limit hit (${res.status}), waiting 10s...`);
    await new Promise((resolve) => setTimeout(resolve, 10000));
    return fetch(url, options);
  }

  return res;
}

function normalizeDate(dateLike: unknown): string | null {
  const raw = String(dateLike || "").trim();
  if (!raw) return null;
  const d = raw.split("T")[0];
  if (!d || d === "0001-01-01") return null;
  return d;
}

function resolveStatus(statusCode: number, hasCheckOut: boolean): string {
  if (statusCode === 6) return "Pausada";
  if (statusCode === 4 || statusCode === 5) return "Finalizada";
  if (statusCode === 3) return "Em andamento";
  if (statusCode === 2) return "Em deslocamento";
  if (statusCode === 1) return "Aberta";
  if (hasCheckOut) return "Finalizada";
  return "Aberta";
}

async function fetchAllEquipments(token: string): Promise<any[]> {
  const headers = auvoHeaders(token);
  const allEquipments: any[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const url = `${AUVO_BASE_URL}/equipments/?paramFilter=${encodeURIComponent("{}")}&page=${page}&pageSize=${pageSize}&order=asc`;
    const res = await rateLimitedFetch(url, { method: "GET", headers });
    if (!res.ok) throw new Error(`Auvo equipments fetch failed (${res.status})`);

    const data = await res.json();
    const list = data?.result?.entityList || [];
    if (!Array.isArray(list) || list.length === 0) break;

    allEquipments.push(...list);
    const totalItems = data?.result?.pagedSearchReturnData?.totalItems || 0;
    console.log(`[equipment-sync] Equipments page ${page}: got ${list.length} (total: ${totalItems})`);

    if (allEquipments.length >= totalItems || list.length < pageSize) break;
    page++;
  }

  return allEquipments;
}

async function fetchAllCategories(token: string): Promise<Map<number, string>> {
  const headers = auvoHeaders(token);
  const catMap = new Map<number, string>();
  let page = 1;
  const pageSize = 100;

  while (true) {
    const url = `${AUVO_BASE_URL}/equipmentCategories/?paramFilter=${encodeURIComponent("{}")}&page=${page}&pageSize=${pageSize}&order=asc`;
    const res = await rateLimitedFetch(url, { method: "GET", headers });
    if (!res.ok) break;

    const data = await res.json();
    const list = data?.result?.entityList || [];
    if (!Array.isArray(list) || list.length === 0) break;

    for (const cat of list) {
      if (typeof cat?.id === "number") {
        catMap.set(cat.id, String(cat.description || "").trim());
      }
    }

    const totalItems = data?.result?.pagedSearchReturnData?.totalItems || 0;
    if (catMap.size >= totalItems || list.length < pageSize) break;
    page++;
  }

  return catMap;
}

async function fetchCustomerName(customerId: number, token: string, cache: Map<number, string>): Promise<string | null> {
  if (customerId <= 0) return null;
  if (cache.has(customerId)) return cache.get(customerId)!;

  try {
    const res = await rateLimitedFetch(`${AUVO_BASE_URL}/customers/${customerId}`, {
      method: "GET",
      headers: auvoHeaders(token),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const name = data?.result?.description || null;
    if (name) cache.set(customerId, name);
    return name;
  } catch {
    return null;
  }
}

// Fetch tasks with native equipment links for a SINGLE date window.
// Called once per month from the frontend to avoid timeout.
async function fetchTasksWithEquipmentsForWindow(
  token: string,
  windowStart: string,
  windowEnd: string,
): Promise<{ results: EquipmentTaskLink[]; totalTasks: number; tasksWithEquipments: number }> {
  const headers = auvoHeaders(token);
  const results: EquipmentTaskLink[] = [];
  let totalTasks = 0;
  let tasksWithEquipments = 0;

  console.log(`[equipment-sync] Fetching tasks ${windowStart} → ${windowEnd}...`);

  let page = 1;
  const maxPages = 100;

  while (page <= maxPages) {
    const filterObj = {
      startDate: `${windowStart}T00:00:00`,
      endDate: `${windowEnd}T23:59:59`,
    };
    const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
    const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${TASK_PAGE_SIZE}&order=desc&paramFilter=${paramFilter}`;

    const res = await rateLimitedFetch(url, { method: "GET", headers });
    if (!res.ok) {
      if (res.status === 404) break;
      const errBody = await res.text().catch(() => "");
      console.error(`[equipment-sync] Tasks listing HTTP ${res.status} page ${page}: ${errBody.substring(0, 300)}`);
      break;
    }

    const json = await res.json();
    const tasks = json?.result?.entityList || json?.result?.Entities || [];
    if (!Array.isArray(tasks) || tasks.length === 0) break;

    totalTasks += tasks.length;

    if (page === 1) {
      const totalItems = json?.result?.pagedSearchReturnData?.totalItems || 0;
      console.log(`[equipment-sync] ${windowStart}: ${totalItems} tasks total`);
    }

    for (const task of tasks) {
      const taskId = String(task.taskID || task.id || "");
      if (!taskId) continue;

      const equipIds: number[] = Array.isArray(task.equipmentsId)
        ? task.equipmentsId
        : Array.isArray(task.equipmentsID)
          ? task.equipmentsID
          : Array.isArray(task.equipmentIds)
            ? task.equipmentIds
            : [];

      if (equipIds.length === 0) continue;
      tasksWithEquipments++;

      const statusCode = typeof task.taskStatus === "number"
        ? task.taskStatus
        : typeof task.taskStatus?.id === "number"
          ? task.taskStatus.id
          : 0;

      results.push({
        taskId,
        equipmentIds: equipIds.map(String),
        taskType: String(task.taskType || ""),
        taskTypeDescription: String(task.taskTypeDescription || ""),
        statusCode,
        taskDate: normalizeDate(task.taskDate),
        checkOutDate: normalizeDate(task.checkOutDate || task.checkoutDate),
        customerDescription: String(task.customerDescription || task.customerName || ""),
        userToName: String(task.userToName || ""),
      });
    }

    if (tasks.length < TASK_PAGE_SIZE) break;
    page++;
  }

  console.log(`[equipment-sync] Total tasks from listing: ${totalTasks}`);
  console.log(`[equipment-sync] Tasks WITH equipmentsId: ${tasksWithEquipments}`);
  return { results, totalTasks, tasksWithEquipments };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const auvoApiKey = Deno.env.get("AUVO_APP_KEY");
    const auvoApiToken = Deno.env.get("AUVO_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!auvoApiKey || !auvoApiToken) {
      return new Response(JSON.stringify({ error: "Missing Auvo credentials" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const url = new URL(req.url);
    const phase = String(body?.phase || url.searchParams.get("phase") || "all");
    const monthsBack = Math.max(1, Math.min(24, Number(body?.months || url.searchParams.get("months") || 12) || 12));

    const sb = createClient(supabaseUrl, serviceKey);
    const accessToken = await auvoLogin(auvoApiKey, auvoApiToken);

    let phase1Result: any = null;
    let phase2Result: any = null;
    let validEquipmentIds: Set<string> | null = null;

    if (phase === "1" || phase === "all") {
      console.log("[equipment-sync] Phase 1: Fetching equipment catalog...");
      const auvoEquipments = await fetchAllEquipments(accessToken);
      console.log(`[equipment-sync] Total equipments from Auvo: ${auvoEquipments.length}`);

      const categories = await fetchAllCategories(accessToken);

      const { data: existingEquip } = await sb
        .from("equipamentos_auvo")
        .select("auvo_equipment_id, cliente");

      const existingClienteMap = new Map<string, string>();
      for (const row of existingEquip || []) {
        if (row.auvo_equipment_id && row.cliente) {
          existingClienteMap.set(row.auvo_equipment_id, row.cliente);
        }
      }

      const customerIds = new Set<number>();
      for (const eq of auvoEquipments) {
        if (eq.associatedCustomerId > 0 && !existingClienteMap.has(String(eq.id))) {
          customerIds.add(eq.associatedCustomerId);
        }
      }

      const customerCache = new Map<number, string>();
      let resolved = 0;
      console.log(`[equipment-sync] New customers to resolve: ${customerIds.size}`);
      for (const cid of customerIds) {
        await fetchCustomerName(cid, accessToken, customerCache);
        resolved++;
        if (resolved % 100 === 0) {
          console.log(`[equipment-sync] Resolved ${resolved}/${customerIds.size} customers`);
        }
      }

      const equipRows = auvoEquipments.map((eq) => ({
        auvo_equipment_id: String(eq.id),
        nome: eq.name?.trim() || "",
        identificador: eq.identifier?.trim() || null,
        descricao: eq.description?.trim() || null,
        cliente: eq.associatedCustomerId > 0
          ? customerCache.get(eq.associatedCustomerId) || existingClienteMap.get(String(eq.id)) || null
          : null,
        categoria: eq.categoryId > 0 ? categories.get(eq.categoryId) || null : null,
        status: eq.active ? "Ativo" : "Inativo",
        atualizado_em: new Date().toISOString(),
      }));

      let totalEquipUpserted = 0;
      const equipErrors: string[] = [];

      for (let i = 0; i < equipRows.length; i += UPSERT_BATCH_SIZE) {
        const batch = equipRows.slice(i, i + UPSERT_BATCH_SIZE);
        const { error } = await sb
          .from("equipamentos_auvo")
          .upsert(batch, { onConflict: "auvo_equipment_id" });

        if (error) equipErrors.push(error.message);
        else totalEquipUpserted += batch.length;
      }

      console.log(`[equipment-sync] Phase 1 done: ${totalEquipUpserted} equipment rows upserted`);

      validEquipmentIds = new Set(auvoEquipments.map((eq) => String(eq.id)));
      phase1Result = {
        total_auvo: auvoEquipments.length,
        upserted: totalEquipUpserted,
        categories_found: categories.size,
        new_customers_resolved: customerCache.size,
        errors: equipErrors.length > 0 ? equipErrors : undefined,
      };
    }

    if (phase === "2" || phase === "all") {
      console.log(`[equipment-sync] Phase 2: Fetching tasks with equipment links (${monthsBack} months)...`);
      const tasksWithEquipments = await fetchAllTasksWithEquipments(accessToken, monthsBack);
      console.log(`[equipment-sync] Tasks with equipment links found: ${tasksWithEquipments.length}`);

      if (!validEquipmentIds) {
        const { data: eqData } = await sb
          .from("equipamentos_auvo")
          .select("auvo_equipment_id");
        validEquipmentIds = new Set((eqData || []).map((row) => row.auvo_equipment_id).filter(Boolean));
      }

      const relRows: any[] = [];
      let discardedLinks = 0;
      const equipmentsWithTasks = new Set<string>();

      for (const task of tasksWithEquipments) {
        if (!task.taskId) continue;

        for (const eqId of task.equipmentIds) {
          if (!validEquipmentIds.has(eqId)) {
            discardedLinks++;
            continue;
          }

          equipmentsWithTasks.add(eqId);
          relRows.push({
            auvo_equipment_id: eqId,
            auvo_task_id: task.taskId,
            auvo_task_type_id: task.taskType || null,
            auvo_task_type_description: task.taskTypeDescription || null,
            status_auvo: resolveStatus(task.statusCode, !!task.checkOutDate),
            data_tarefa: task.taskDate || null,
            data_conclusao: task.checkOutDate || null,
            cliente: task.customerDescription || null,
            tecnico: task.userToName || null,
            auvo_link: `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${task.taskId}`,
            source: "native_equipment_relation",
            synced_at: new Date().toISOString(),
          });
        }
      }

      console.log(`[equipment-sync] Relational rows to upsert: ${relRows.length}`);
      console.log(`[equipment-sync] Equipments with tasks: ${equipmentsWithTasks.size}`);
      console.log(`[equipment-sync] Discarded links (invalid equipment ID): ${discardedLinks}`);

      let totalRelUpserted = 0;
      const relErrors: string[] = [];

      for (let i = 0; i < relRows.length; i += UPSERT_BATCH_SIZE) {
        const batch = relRows.slice(i, i + UPSERT_BATCH_SIZE);
        const { error } = await sb
          .from("equipamento_tarefas_auvo")
          .upsert(batch, { onConflict: "auvo_equipment_id,auvo_task_id" });

        if (error) {
          relErrors.push(error.message);
          console.error(`[equipment-sync] Rel batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1} error: ${error.message}`);
        } else {
          totalRelUpserted += batch.length;
        }
      }

      console.log(`[equipment-sync] Equipment-task relationships upserted: ${totalRelUpserted}`);

      phase2Result = {
        tasks_with_equipment_links: tasksWithEquipments.length,
        relationship_rows_upserted: totalRelUpserted,
        equipments_with_tasks: equipmentsWithTasks.size,
        discarded_invalid_links: discardedLinks,
        errors: relErrors.length > 0 ? relErrors : undefined,
      };
    }

    return new Response(JSON.stringify({
      success: true,
      phase_executed: phase,
      phase1_equipment_catalog: phase1Result,
      phase2_equipment_tasks: phase2Result,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[equipment-sync] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});