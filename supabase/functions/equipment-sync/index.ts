import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Auvo login failed (${res.status})`);
  const data = await res.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: no accessToken");
  return token;
}

function auvoHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  await new Promise(r => setTimeout(r, 250));
  const res = await fetch(url, options);
  if (res.status === 403 || res.status === 429) {
    console.log(`Rate limit hit (${res.status}), waiting 20s...`);
    await new Promise(r => setTimeout(r, 20000));
    return fetch(url, options);
  }
  return res;
}

// ── Fetch all equipments from Auvo ──
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
    const list = data?.result?.entityList;
    if (!list || list.length === 0) break;

    allEquipments.push(...list);
    const totalItems = data?.result?.pagedSearchReturnData?.totalItems || 0;
    console.log(`Equipments page ${page}: got ${list.length} (total: ${totalItems})`);

    if (allEquipments.length >= totalItems) break;
    page++;
  }

  return allEquipments;
}

// ── Fetch all categories ──
async function fetchAllCategories(token: string): Promise<Map<number, string>> {
  const headers = auvoHeaders(token);
  const catMap = new Map<number, string>();
  let page = 1;

  while (true) {
    const url = `${AUVO_BASE_URL}/equipmentCategories/?paramFilter=${encodeURIComponent("{}")}&page=${page}&pageSize=100&order=asc`;
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) break;
    const data = await res.json();
    const list = data?.result?.entityList;
    if (!list || list.length === 0) break;
    for (const cat of list) catMap.set(cat.id, cat.description);
    const totalItems = data?.result?.pagedSearchReturnData?.totalItems || 0;
    if (catMap.size >= totalItems) break;
    page++;
  }

  return catMap;
}

// ── Fetch customer name ──
async function fetchCustomerName(customerId: number, token: string, cache: Map<number, string>): Promise<string | null> {
  if (customerId <= 0) return null;
  if (cache.has(customerId)) return cache.get(customerId)!;

  try {
    const res = await rateLimitedFetch(`${AUVO_BASE_URL}/customers/${customerId}`, { method: "GET", headers: auvoHeaders(token) });
    if (!res.ok) return null;
    const d = await res.json();
    const name = d?.result?.description || null;
    if (name) cache.set(customerId, name);
    return name;
  } catch {
    return null;
  }
}

// ── Fetch ALL tasks that reference a given equipment ID ──
// The Auvo tasks API returns `equipmentsId: [id1, id2, ...]` in each task.
// There's no direct "get tasks by equipment" endpoint, so we use the tasks
// listing with a broad date range and filter by equipmentsId client-side.
// However, this is expensive. Instead, we fetch tasks from central-sync's
// already-synced data in tarefas_central via the snapshot.
// 
// BETTER APPROACH: We fetch ALL tasks from Auvo (paginated, recent 12 months)
// and extract equipmentsId from each one. This builds the relational table.
async function fetchAllTasksWithEquipments(token: string, monthsBack: number = 6): Promise<Array<{
  taskId: string;
  equipmentIds: string[];
  taskType: string;
  taskTypeDescription: string;
  statusCode: number;
  taskDate: string | null;
  checkOutDate: string | null;
  customerDescription: string;
  userToName: string;
}>> {
  const headers = auvoHeaders(token);
  const results: Array<any> = [];
  
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  
  // Process month by month
  const current = new Date(startDate);
  while (current <= now) {
    const monthStart = current.toISOString().split("T")[0];
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const clampedEnd = monthEnd > now ? now.toISOString().split("T")[0] : monthEnd.toISOString().split("T")[0];
    
    console.log(`[equipment-sync] Fetching tasks ${monthStart} → ${clampedEnd}...`);
    
    let page = 1;
    const pageSize = 100;
    const MAX_PAGES = 30;
    
    while (page <= MAX_PAGES) {
      const filterObj = { startDate: `${monthStart}T00:00:00`, endDate: `${clampedEnd}T23:59:59` };
      const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
      const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;
      
      const res = await rateLimitedFetch(url, { method: "GET", headers });
      
      if (!res.ok) {
        if (res.status === 404) break;
        console.error(`[equipment-sync] Tasks fetch error ${res.status}`);
        break;
      }
      
      const json = await res.json();
      const tasks = json?.result?.entityList || json?.result?.Entities || [];
      if (!Array.isArray(tasks) || tasks.length === 0) break;
      
      for (const task of tasks) {
        const equipIds: number[] = Array.isArray(task.equipmentsId) ? task.equipmentsId :
          Array.isArray(task.equipmentsID) ? task.equipmentsID : [];
        
        if (equipIds.length > 0) {
          const statusCode = typeof task.taskStatus === "number" ? task.taskStatus
            : typeof task.taskStatus?.id === "number" ? task.taskStatus.id : 0;
          
          results.push({
            taskId: String(task.taskID || task.id || ""),
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
      }
      
      if (tasks.length < pageSize) break;
      page++;
    }
    
    current.setMonth(current.getMonth() + 1);
    current.setDate(1);
  }
  
  return results;
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
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(supabaseUrl, serviceKey);
    const accessToken = await auvoLogin(auvoApiKey, auvoApiToken);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Sync equipment catalog (existing logic)
    // ═══════════════════════════════════════════════════════════════
    console.log("[equipment-sync] Phase 1: Fetching equipment catalog...");
    const auvoEquipments = await fetchAllEquipments(accessToken);
    console.log(`[equipment-sync] Total equipments from Auvo: ${auvoEquipments.length}`);

    const categories = await fetchAllCategories(accessToken);

    // Resolve customer names
    const customerIds = new Set<number>();
    for (const eq of auvoEquipments) {
      if (eq.associatedCustomerId > 0) customerIds.add(eq.associatedCustomerId);
    }
    const customerCache = new Map<number, string>();
    let resolved = 0;
    for (const cid of customerIds) {
      await fetchCustomerName(cid, accessToken, customerCache);
      resolved++;
      if (resolved % 50 === 0) {
        console.log(`[equipment-sync] Resolved ${resolved}/${customerIds.size} customers`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Upsert equipment catalog
    const equipRows = auvoEquipments.map(eq => ({
      auvo_equipment_id: String(eq.id),
      nome: eq.name?.trim() || "",
      identificador: eq.identifier?.trim() || null,
      descricao: eq.description?.trim() || null,
      cliente: eq.associatedCustomerId > 0 ? customerCache.get(eq.associatedCustomerId) || null : null,
      categoria: eq.categoryId > 0 ? categories.get(eq.categoryId) || null : null,
      status: eq.active ? "Ativo" : "Inativo",
      atualizado_em: new Date().toISOString(),
    }));

    const BATCH_SIZE = 500;
    let totalEquipUpserted = 0;
    const equipErrors: string[] = [];

    for (let i = 0; i < equipRows.length; i += BATCH_SIZE) {
      const batch = equipRows.slice(i, i + BATCH_SIZE);
      const { error } = await sb.from("equipamentos_auvo").upsert(batch, { onConflict: "auvo_equipment_id" });
      if (error) {
        equipErrors.push(error.message);
      } else {
        totalEquipUpserted += batch.length;
      }
    }
    console.log(`[equipment-sync] Phase 1 done: ${totalEquipUpserted} equipment rows upserted`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Sync native equipment-task relationships
    // ═══════════════════════════════════════════════════════════════
    console.log("[equipment-sync] Phase 2: Fetching tasks with equipment links (12 months)...");
    const tasksWithEquipments = await fetchAllTasksWithEquipments(accessToken, 12);
    console.log(`[equipment-sync] Tasks with equipment links found: ${tasksWithEquipments.length}`);

    // Build equipment ID set for validation
    const validEquipmentIds = new Set(auvoEquipments.map(eq => String(eq.id)));

    // Build relational rows
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
        const statusAuvo = resolveStatus(task.statusCode, !!task.checkOutDate);

        relRows.push({
          auvo_equipment_id: eqId,
          auvo_task_id: task.taskId,
          auvo_task_type_id: task.taskType || null,
          auvo_task_type_description: task.taskTypeDescription || null,
          status_auvo: statusAuvo,
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

    // Upsert relational rows in batches
    let totalRelUpserted = 0;
    const relErrors: string[] = [];

    for (let i = 0; i < relRows.length; i += BATCH_SIZE) {
      const batch = relRows.slice(i, i + BATCH_SIZE);
      const { error } = await sb
        .from("equipamento_tarefas_auvo")
        .upsert(batch, { onConflict: "auvo_equipment_id,auvo_task_id" });
      if (error) {
        console.error(`[equipment-sync] Rel batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
        relErrors.push(error.message);
      } else {
        totalRelUpserted += batch.length;
      }
    }

    console.log(`[equipment-sync] Phase 2 done: ${totalRelUpserted} relationship rows upserted`);

    return new Response(JSON.stringify({
      success: true,
      phase1_equipment_catalog: {
        total_auvo: auvoEquipments.length,
        upserted: totalEquipUpserted,
        categories_found: categories.size,
        customers_resolved: customerCache.size,
        errors: equipErrors.length > 0 ? equipErrors : undefined,
      },
      phase2_equipment_tasks: {
        tasks_with_equipment_links: tasksWithEquipments.length,
        relationship_rows_upserted: totalRelUpserted,
        equipments_with_tasks: equipmentsWithTasks.size,
        discarded_invalid_links: discardedLinks,
        errors: relErrors.length > 0 ? relErrors : undefined,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[equipment-sync] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
