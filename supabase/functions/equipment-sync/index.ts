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
  await new Promise(r => setTimeout(r, 100));
  const res = await fetch(url, options);
  if (res.status === 403 || res.status === 429) {
    console.log(`Rate limit hit (${res.status}), waiting 10s...`);
    await new Promise(r => setTimeout(r, 10000));
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

// ── Fetch individual task detail to get equipmentsId ──
// CRITICAL: The listing endpoint GET /tasks/ returns equipmentsId as EMPTY [].
// Only the detail endpoint GET /tasks/{id} returns the real equipmentsId.
async function fetchTaskDetail(taskId: string, token: string): Promise<any | null> {
  const url = `${AUVO_BASE_URL}/tasks/${encodeURIComponent(taskId)}`;
  const res = await rateLimitedFetch(url, { method: "GET", headers: auvoHeaders(token) });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return json?.result || null;
}

// ── Collect task IDs from listing, then fetch details for equipmentsId ──
async function fetchAllTasksWithEquipments(
  token: string,
  monthsBack: number,
  existingTaskIds: Set<string>
): Promise<Array<{
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
  const allTaskIds: Array<{ id: string; taskType: string; taskTypeDescription: string; taskDate: string | null; checkOutDate: string | null; customerDescription: string; userToName: string; statusCode: number }> = [];
  
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  
  // STEP 1: Collect all task IDs from listing (fast, no equipmentsId needed)
  const current = new Date(startDate);
  while (current <= now) {
    const monthStart = current.toISOString().split("T")[0];
    const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
    const clampedEnd = monthEnd > now ? now.toISOString().split("T")[0] : monthEnd.toISOString().split("T")[0];
    
    let page = 1;
    const pageSize = 200;
    
    while (page <= 50) {
      const filterObj = { startDate: `${monthStart}T00:00:00`, endDate: `${clampedEnd}T23:59:59` };
      const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
      const url = `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;
      
      const res = await rateLimitedFetch(url, { method: "GET", headers });
      if (!res.ok) {
        console.error(`[equipment-sync] Tasks listing HTTP ${res.status} for ${monthStart} page ${page}`);
        const errBody = await res.text().catch(() => "");
        console.error(`[equipment-sync] Response body: ${errBody.substring(0, 300)}`);
        break;
      }
      
      const json = await res.json();
      const tasks = json?.result?.entityList || [];
      if (page === 1 && tasks.length === 0) {
        // Log raw response for debugging
        const rawKeys = json?.result ? Object.keys(json.result).join(",") : JSON.stringify(json).substring(0, 300);
        console.log(`[equipment-sync] ${monthStart}: EMPTY. Raw keys: ${rawKeys}`);
      }
      if (!Array.isArray(tasks) || tasks.length === 0) break;
      
      if (page === 1) {
        const totalItems = json?.result?.pagedSearchReturnData?.totalItems || 0;
        console.log(`[equipment-sync] ${monthStart}: ${totalItems} tasks total`);
      }
      
      for (const task of tasks) {
        const taskId = String(task.taskID || task.id || "");
        if (!taskId) continue;
        
        const statusCode = typeof task.taskStatus === "number" ? task.taskStatus
          : typeof task.taskStatus?.id === "number" ? task.taskStatus.id : 0;
        
        allTaskIds.push({
          id: taskId,
          taskType: String(task.taskType || ""),
          taskTypeDescription: String(task.taskTypeDescription || ""),
          taskDate: normalizeDate(task.taskDate),
          checkOutDate: normalizeDate(task.checkOutDate || task.checkoutDate),
          customerDescription: String(task.customerDescription || task.customerName || ""),
          userToName: String(task.userToName || ""),
          statusCode,
        });
      }
      
      if (tasks.length < pageSize) break;
      page++;
    }
    
    current.setMonth(current.getMonth() + 1);
    current.setDate(1);
  }
  
  console.log(`[equipment-sync] Total tasks from listing: ${allTaskIds.length}`);
  
  // Filter out tasks already in DB
  const newTasks = allTaskIds.filter(t => !existingTaskIds.has(t.id));
  console.log(`[equipment-sync] New tasks to fetch detail: ${newTasks.length} (${existingTaskIds.size} already in DB)`);
  
  // STEP 2: Fetch individual task details in batches to get equipmentsId
  const results: Array<any> = [];
  const BATCH_SIZE = 5;
  let fetched = 0;
  let withEquipment = 0;
  
  for (let i = 0; i < newTasks.length; i += BATCH_SIZE) {
    const batch = newTasks.slice(i, i + BATCH_SIZE);
    const detailPromises = batch.map(t => fetchTaskDetail(t.id, token));
    const details = await Promise.all(detailPromises);
    
    for (let j = 0; j < batch.length; j++) {
      fetched++;
      const detail = details[j];
      const taskMeta = batch[j];
      if (!detail) continue;
      
      const equipIds: string[] = Array.isArray(detail.equipmentsId) ? detail.equipmentsId.map(String) :
        Array.isArray(detail.equipmentsID) ? detail.equipmentsID.map(String) : [];
      
      if (equipIds.length > 0) {
        withEquipment++;
        results.push({
          taskId: taskMeta.id,
          equipmentIds: equipIds,
          taskType: taskMeta.taskType,
          taskTypeDescription: taskMeta.taskTypeDescription,
          statusCode: taskMeta.statusCode,
          taskDate: taskMeta.taskDate,
          checkOutDate: normalizeDate(detail.checkOutDate || detail.checkoutDate) || taskMeta.checkOutDate,
          customerDescription: taskMeta.customerDescription,
          userToName: taskMeta.userToName,
        });
      }
      
      // Log first detail for debugging
      if (fetched === 1) {
        const sampleEquip = JSON.stringify(detail.equipmentsId || detail.equipmentsID || "none").substring(0, 200);
        console.log(`[equipment-sync] Sample task detail ${taskMeta.id}: equipmentsId=${sampleEquip}`);
      }
    }
    
    // Progress log every 50 tasks
    if (fetched % 50 === 0) {
      console.log(`[equipment-sync] Detail progress: ${fetched}/${newTasks.length}, with equipment: ${withEquipment}`);
    }
    
    // Small delay between batches
    await new Promise(r => setTimeout(r, 150));
  }
  
  console.log(`[equipment-sync] Detail fetch complete: ${fetched} fetched, ${withEquipment} with equipment links`);
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

    // Parse phase parameter: "1" = catalog only, "2" = relationships only, "all" = both (default)
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const url = new URL(req.url);
    const phase = body?.phase || url.searchParams.get("phase") || "all";
    const monthsBack = Number(body?.months || url.searchParams.get("months") || "6");

    const sb = createClient(supabaseUrl, serviceKey);
    const accessToken = await auvoLogin(auvoApiKey, auvoApiToken);

    let phase1Result: any = null;
    let phase2Result: any = null;
    let validEquipmentIds: Set<string> | null = null;

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Sync equipment catalog
    // ═══════════════════════════════════════════════════════════════
    if (phase === "1" || phase === "all") {
      console.log("[equipment-sync] Phase 1: Fetching equipment catalog...");
      const auvoEquipments = await fetchAllEquipments(accessToken);
      console.log(`[equipment-sync] Total equipments from Auvo: ${auvoEquipments.length}`);

      const categories = await fetchAllCategories(accessToken);

      // Load existing customer names from DB to avoid re-resolving
      const { data: existingEquip } = await sb
        .from("equipamentos_auvo")
        .select("auvo_equipment_id, cliente");
      const existingClienteMap = new Map<string, string>();
      if (existingEquip) {
        for (const e of existingEquip) {
          if (e.auvo_equipment_id && e.cliente) existingClienteMap.set(e.auvo_equipment_id, e.cliente);
        }
      }

      // Only resolve NEW customer IDs not already in DB
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

      // Upsert equipment catalog
      const equipRows = auvoEquipments.map(eq => ({
        auvo_equipment_id: String(eq.id),
        nome: eq.name?.trim() || "",
        identificador: eq.identifier?.trim() || null,
        descricao: eq.description?.trim() || null,
        cliente: eq.associatedCustomerId > 0
          ? (customerCache.get(eq.associatedCustomerId) || existingClienteMap.get(String(eq.id)) || null)
          : null,
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
        if (error) equipErrors.push(error.message);
        else totalEquipUpserted += batch.length;
      }
      console.log(`[equipment-sync] Phase 1 done: ${totalEquipUpserted} equipment rows upserted`);

      validEquipmentIds = new Set(auvoEquipments.map(eq => String(eq.id)));
      phase1Result = {
        total_auvo: auvoEquipments.length,
        upserted: totalEquipUpserted,
        categories_found: categories.size,
        new_customers_resolved: customerCache.size,
        errors: equipErrors.length > 0 ? equipErrors : undefined,
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Sync native equipment-task relationships
    // ═══════════════════════════════════════════════════════════════
    if (phase === "2" || phase === "all") {
      console.log(`[equipment-sync] Phase 2: Fetching tasks with equipment links (${monthsBack} months)...`);
      
      // Load existing task IDs from DB to skip re-fetching
      const existingTaskIds = new Set<string>();
      let etFrom = 0;
      while (true) {
        const { data: etData } = await sb
          .from("equipamento_tarefas_auvo")
          .select("auvo_task_id")
          .range(etFrom, etFrom + 999);
        if (!etData || etData.length === 0) break;
        for (const r of etData) existingTaskIds.add(r.auvo_task_id);
        if (etData.length < 1000) break;
        etFrom += 1000;
      }
      console.log(`[equipment-sync] Existing task-equipment relations in DB: ${existingTaskIds.size}`);
      
      const tasksWithEquipments = await fetchAllTasksWithEquipments(accessToken, monthsBack, existingTaskIds);
      console.log(`[equipment-sync] Tasks with equipment links found: ${tasksWithEquipments.length}`);

      // Load valid equipment IDs if not already loaded from Phase 1
      if (!validEquipmentIds) {
        const { data: eqData } = await sb.from("equipamentos_auvo").select("auvo_equipment_id");
        validEquipmentIds = new Set((eqData || []).map(e => e.auvo_equipment_id).filter(Boolean));
      }

      const relRows: any[] = [];
      let discardedLinks = 0;
      const equipmentsWithTasks = new Set<string>();

      for (const task of tasksWithEquipments) {
        if (!task.taskId) continue;
        for (const eqId of task.equipmentIds) {
          if (!validEquipmentIds.has(eqId)) { discardedLinks++; continue; }
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

      let totalRelUpserted = 0;
      const relErrors: string[] = [];
      for (let i = 0; i < relRows.length; i += 500) {
        const batch = relRows.slice(i, i + 500);
        const { error } = await sb
          .from("equipamento_tarefas_auvo")
          .upsert(batch, { onConflict: "auvo_equipment_id,auvo_task_id" });
        if (error) { relErrors.push(error.message); console.error(`[equipment-sync] Rel error:`, error.message); }
        else totalRelUpserted += batch.length;
      }
      console.log(`[equipment-sync] Phase 2 done: ${totalRelUpserted} relationship rows upserted`);

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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
