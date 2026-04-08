import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const TASK_PAGE_SIZE = 100;
const TASK_COUNT_PAGE_SIZE = 10;
const UPSERT_BATCH_SIZE = 500;
const RATE_LIMIT_DELAY_MS = 50;

// ══════════════════════════════════════════════════════════
// Brand extraction: pure dictionary + regex, no AI
// ══════════════════════════════════════════════════════════

const GENERIC_TYPE_PREFIXES: [string, string][] = [
  ["COIFA", "COIFA"],
];

const MODEL_REGEX_BRANDS: [RegExp, string][] = [
  [/\bNT\s*\d{2,4}\b/i, "NETTER"],
  [/\bXEVC[-\s]?\d/i, "UNOX"],
  [/\bXEBC[-\s]?\d/i, "UNOX"],
  [/\bXEFT[-\s]?\d/i, "UNOX"],
];

const BRAND_FAMILIES: [string, string][] = [
  // RATIONAL
  ["SELFCOOKINGCENTER", "RATIONAL"],
  ["SELF COOKING CENTER", "RATIONAL"],
  ["ICOMBI CLASSIC", "RATIONAL"],
  ["ICOMBI PRO", "RATIONAL"],
  ["ICOMBI", "RATIONAL"],
  ["IVARIO", "RATIONAL"],
  ["SCC WE", "RATIONAL"],
  ["SCC 61", "RATIONAL"],
  ["SCC 101", "RATIONAL"],
  ["SCC 201", "RATIONAL"],
  ["SCC 62", "RATIONAL"],
  ["SCC 102", "RATIONAL"],
  ["SCC 202", "RATIONAL"],
  ["RATIONAL", "RATIONAL"],
  // HOBART
  ["ECOMAX 400", "HOBART"],
  ["ECOMAX 503", "HOBART"],
  ["ECOMAX 603", "HOBART"],
  ["ECOMAX", "HOBART"],
  ["CENTERLINE", "HOBART"],
  ["BAXTER", "HOBART"],
  ["TRAULSEN", "HOBART"],
  ["BERKEL", "HOBART"],
  ["HCM30", "HOBART"],
  ["HCA30", "HOBART"],
  ["HMD30", "HOBART"],
  ["HL400", "HOBART"],
  ["HL600", "HOBART"],
  ["HOBART", "HOBART"],
  // VULCAN
  ["VCRG24", "VULCAN"],
  ["VCRG48", "VULCAN"],
  ["VCRH12", "VULCAN"],
  ["LG300", "VULCAN"],
  ["VULCAN", "VULCAN"],
  // WINTERHALTER
  ["WINTERHALTER", "WINTERHALTER"],
  ["CLASSEQ", "WINTERHALTER"],
  ["D9000", "WINTERHALTER"],
  ["D3000", "WINTERHALTER"],
  ["D6000", "WINTERHALTER"],
  ["D600", "WINTERHALTER"],
  ["UC-S", "WINTERHALTER"],
  ["UC-M", "WINTERHALTER"],
  ["UC-L", "WINTERHALTER"],
  ["UC-XL", "WINTERHALTER"],
  ["U50", "WINTERHALTER"],
  ["PT-M", "WINTERHALTER"],
  ["PT-L", "WINTERHALTER"],
  ["PT-XL", "WINTERHALTER"],
  ["P50", "WINTERHALTER"],
  ["UF-M", "WINTERHALTER"],
  ["UF-L", "WINTERHALTER"],
  ["UF-XL", "WINTERHALTER"],
  // NETTER
  ["NETTER", "NETTER"],
  ["TWISTER", "NETTER"],
  // ROBOT COUPE
  ["ROBOT COUPE", "ROBOT COUPE"],
  ["ROBOT-COUPE", "ROBOT COUPE"],
  // PRÁTICA
  ["PRÁTICA KLIMAQUIP", "PRÁTICA"],
  ["PRATICA KLIMAQUIP", "PRÁTICA"],
  ["KLIMAQUIP", "PRÁTICA"],
  ["TECHNICOOK", "PRÁTICA"],
  ["C-MAX EVO", "PRÁTICA"],
  ["CG-MAX EVO", "PRÁTICA"],
  ["CG-MAX", "PRÁTICA"],
  ["C-MAX", "PRÁTICA"],
  ["MINICONV", "PRÁTICA"],
  ["FORZA STI", "PRÁTICA"],
  ["FIT EXPRESS", "PRÁTICA"],
  ["KLIMAPRO", "PRÁTICA"],
  ["PRCOP", "PRÁTICA"],
  ["PRÁTICA", "PRÁTICA"],
  ["PRATICA", "PRÁTICA"],
  // UNOX
  ["CHEFTOP MIND", "UNOX"],
  ["BAKERTOP MIND", "UNOX"],
  ["CHEFTOP-X", "UNOX"],
  ["BAKERTOP-X", "UNOX"],
  ["CHEFTOP", "UNOX"],
  ["BAKERTOP", "UNOX"],
  ["BAKERLUX", "UNOX"],
  ["SPEED-X", "UNOX"],
  ["SPEED.PRO", "UNOX"],
  ["SPEED.COMPACT", "UNOX"],
  ["LINEMICRO", "UNOX"],
  ["EVEREO", "UNOX"],
  ["UNOX", "UNOX"],
  // MIDDLEBY
  ["TURBOCHEF", "MIDDLEBY"],
  ["MERRYCHEF", "MIDDLEBY"],
  ["PITCO", "MIDDLEBY"],
  ["JOSPER", "MIDDLEBY"],
  ["MIDDLEBY", "MIDDLEBY"],
  // HOSHIZAKI MACOM
  ["HOSHIZAKI MACOM", "HOSHIZAKI MACOM"],
  ["HOSHIZAKI", "HOSHIZAKI MACOM"],
  ["MACOM", "HOSHIZAKI MACOM"],
  // COZIL
  ["AUTOCOOK PRO", "COZIL"],
  ["CBEM-200", "COZIL"],
  ["CBEM-300", "COZIL"],
  ["CBEM-500", "COZIL"],
  ["COZIL", "COZIL"],
  // TRAMONTINA
  ["T.CHEF", "TRAMONTINA"],
  ["TRAMONTINA", "TRAMONTINA"],
  // DEMAIS
  ["GELOPAR", "GELOPAR"],
  ["METALFRIO", "METALFRIO"],
  ["SKYMSEN", "SKYMSEN"],
  ["SIEMSEN", "SKYMSEN"],
  ["RODRIAÇO", "RODRIAÇO"],
  ["RODRIACO", "RODRIAÇO"],
  ["FRICON", "FRICON"],
  ["ELGIN", "ELGIN"],
  ["VENÂNCIO", "VENÂNCIO"],
  ["VENANCIO", "VENÂNCIO"],
  ["BRAESI", "BRAESI"],
  ["EVEREST", "EVEREST"],
  ["GPANIZ", "GPANIZ"],
  ["G.PANIZ", "GPANIZ"],
  ["G PANIZ", "GPANIZ"],
  ["PROGÁS", "PROGÁS"],
  ["PROGAS", "PROGÁS"],
  ["ELECTROLUX", "ELECTROLUX"],
  ["ELETROLUX", "ELECTROLUX"],
  ["CONSUL", "CONSUL"],
  ["FRILUX", "FRILUX"],
  ["CONVOTHERM", "CONVOTHERM"],
  ["HUSSMANN", "HUSSMANN"],
  ["VENAX", "VENAX"],
  ["CITROLIFE", "CITROLIFE"],
  ["CROYDON", "CROYDON"],
  ["METVISA", "METVISA"],
  ["MARCHESONI", "MARCHESONI"],
  ["TOPEMA", "TOPEMA"],
  ["METALCUBAS", "METALCUBAS"],
  ["LINCAT", "LINCAT"],
  ["SOVRANO", "SOVRANO"],
  ["MORETTI FORNI", "MORETTI FORNI"],
  ["MORETTI", "MORETTI FORNI"],
  ["GASTROMAQ", "GASTROMAQ"],
  ["BERMAR", "BERMAR"],
  ["WARING", "WARING"],
  ["IMBERA", "IMBERA"],
  ["REFRIMATE", "REFRIMATE"],
  ["FIAMMA", "FIAMMA"],
  ["BRAVILOR", "BRAVILOR"],
  ["BUNN", "BUNN"],
  ["IRINOX", "IRINOX"],
  ["FISCHER", "FISCHER"],
  ["IBBL", "IBBL"],
  ["KOFISA", "KOFISA"],
  ["METALMAQ", "METALMAQ"],
  ["RAMUZA", "RAMUZA"],
  ["SPOLU", "SPOLU"],
  ["TOLEDO", "TOLEDO"],
  ["PRIX", "TOLEDO"],
  ["MENUMASTER", "MENUMASTER"],
  ["PANASONIC", "PANASONIC"],
  ["SAMSUNG", "SAMSUNG"],
  ["MIDEA", "MIDEA"],
  ["PHILCO", "PHILCO"],
  ["BRITÂNIA", "BRITÂNIA"],
  ["BRITANIA", "BRITÂNIA"],
  ["COLOMBO", "COLOMBO"],
  ["FOGATTI", "FOGATTI"],
  ["ELETROFER", "ELETROFER"],
  ["KARCHER", "KÄRCHER"],
  ["KÄRCHER", "KÄRCHER"],
  ["HITACHI", "HITACHI"],
  ["GREE", "GREE"],
  ["SPRINGER", "SPRINGER"],
  ["CARRIER", "CARRIER"],
  ["DAIKIN", "DAIKIN"],
  ["KOMECO", "KOMECO"],
  ["MICHELETTI", "MICHELETTI"],
  ["WELMY", "WELMY"],
  ["URANO", "URANO"],
  ["CATAVENTO", "CATAVENTO"],
  ["AGRATTO", "AGRATTO"],
  ["TECHNOSTEEL", "TECHNOSTEEL"],
];

function extractBrand(nome: string): string | null {
  const upper = (nome || "").toUpperCase().trim();
  if (!upper) return null;

  // 1. Generic type prefixes (highest priority)
  for (const [prefix, brand] of GENERIC_TYPE_PREFIXES) {
    if (upper.startsWith(prefix)) return brand;
  }

  // 2. Model regex patterns
  for (const [regex, brand] of MODEL_REGEX_BRANDS) {
    if (regex.test(upper)) return brand;
  }

  // 3. Brand family dictionary (longer terms first)
  for (const [term, brand] of BRAND_FAMILIES) {
    if (upper.includes(term)) return brand;
  }

  return null;
}

// ══════════════════════════════════════════════════════════
// Auvo API helpers
// ══════════════════════════════════════════════════════════

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
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
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

function buildTasksListUrl(windowStart: string, windowEnd: string, page: number, pageSize: number): string {
  const filterObj = {
    startDate: `${windowStart}T00:00:00`,
    endDate: `${windowEnd}T23:59:59`,
  };
  const paramFilter = encodeURIComponent(JSON.stringify(filterObj));
  return `${AUVO_BASE_URL}/tasks/?page=${page}&pageSize=${pageSize}&order=desc&paramFilter=${paramFilter}`;
}

async function fetchTaskCountForWindow(token: string, windowStart: string, windowEnd: string): Promise<number> {
  const headers = auvoHeaders(token);
  const url = buildTasksListUrl(windowStart, windowEnd, 1, TASK_COUNT_PAGE_SIZE);
  const res = await rateLimitedFetch(url, { method: "GET", headers });

  if (!res.ok) {
    if (res.status === 404) return 0;
    const errBody = await res.text().catch(() => "");
    throw new Error(`Auvo tasks count failed (${res.status}): ${errBody.substring(0, 300)}`);
  }

  const json = await res.json();
  const totalItems = Number(
    json?.result?.pagedSearchReturnData?.totalItems
      ?? json?.result?.entityList?.length
      ?? json?.result?.Entities?.length
      ?? 0,
  );

  console.log(`[equipment-sync] ${windowStart}: ${totalItems} tasks total`);
  return totalItems;
}

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
    const url = buildTasksListUrl(windowStart, windowEnd, page, TASK_PAGE_SIZE);

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

async function loadValidEquipmentIdsFromDb(sb: any): Promise<Set<string>> {
  const validEquipmentIds = new Set<string>();
  let eqFrom = 0;

  while (true) {
    const { data: eqData } = await sb
      .from("equipamentos_auvo")
      .select("auvo_equipment_id")
      .range(eqFrom, eqFrom + 999);

    if (!eqData || eqData.length === 0) break;

    for (const row of eqData) {
      if (row.auvo_equipment_id) validEquipmentIds.add(row.auvo_equipment_id);
    }

    if (eqData.length < 1000) break;
    eqFrom += 1000;
  }

  return validEquipmentIds;
}

// ══════════════════════════════════════════════════════════
// Main handler
// ══════════════════════════════════════════════════════════

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
    try { body = await req.json(); } catch { body = {}; }

    const url = new URL(req.url);
    const phase = String(body?.phase || url.searchParams.get("phase") || "all");
    const startDateParam = String(body?.startDate || url.searchParams.get("startDate") || "");
    const endDateParam = String(body?.endDate || url.searchParams.get("endDate") || "");
    const providedValidEquipmentIds = Array.isArray(body?.validEquipmentIds)
      ? Array.from(new Set(body.validEquipmentIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)))
      : [];
    const skipEquipmentValidation = body?.skipEquipmentValidation === true || url.searchParams.get("skipEquipmentValidation") === "true";
    const isCountOnly = phase === "2-count" || body?.countOnly === true || url.searchParams.get("countOnly") === "true";

    const sb = createClient(supabaseUrl, serviceKey);
    const accessToken = await auvoLogin(auvoApiKey, auvoApiToken);

    let phase1Result: any = null;
    let phase2Result: any = null;
    let validEquipmentIds: Set<string> | null = null;

    // ── Phase 1: Equipment catalog + brand extraction ──
    if (phase === "1" || phase === "all") {
      console.log("[equipment-sync] Phase 1: Fetching equipment catalog...");
      const auvoEquipments = await fetchAllEquipments(accessToken);
      console.log(`[equipment-sync] Total equipments from Auvo: ${auvoEquipments.length}`);

      const categories = await fetchAllCategories(accessToken);

      // Load existing cliente values to preserve them
      const { data: existingEquip } = await sb
        .from("equipamentos_auvo")
        .select("auvo_equipment_id, cliente");

      const existingClienteMap = new Map<string, string>();
      for (const row of existingEquip || []) {
        if (row.auvo_equipment_id && row.cliente) {
          existingClienteMap.set(row.auvo_equipment_id, row.cliente);
        }
      }

      // Resolve new customer names
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

      // Load manual override protection
      const { data: protectedRows } = await sb
        .from("equipamentos_auvo")
        .select("auvo_equipment_id")
        .eq("marca_manual_override", true);

      const protectedIds = new Set(protectedRows?.map(r => r.auvo_equipment_id) || []);

      // Build rows with brand extraction
      let withBrand = 0;
      let withoutBrand = 0;
      const brandCounts = new Map<string, number>();

      const equipRows = auvoEquipments.map((eq) => {
        const nome = eq.name?.trim() || "";
        const eqId = String(eq.id);
        const parsedBrand = extractBrand(nome);

        if (parsedBrand) {
          withBrand++;
          brandCounts.set(parsedBrand, (brandCounts.get(parsedBrand) || 0) + 1);
        } else {
          withoutBrand++;
        }

        const row: any = {
          auvo_equipment_id: eqId,
          nome,
          identificador: eq.identifier?.trim() || null,
          descricao: eq.description?.trim() || null,
          cliente: eq.associatedCustomerId > 0
            ? customerCache.get(eq.associatedCustomerId) || existingClienteMap.get(eqId) || null
            : null,
          categoria: eq.categoryId > 0 ? categories.get(eq.categoryId) || null : null,
          status: eq.active ? "Ativo" : "Inativo",
          atualizado_em: new Date().toISOString(),
        };

        // Only set marca fields if NOT manually overridden
        if (!protectedIds.has(eqId)) {
          row.marca = parsedBrand;
          row.marca_source = parsedBrand ? "auto_parsed" : null;
        }

        return row;
      });

      console.log(`[equipment-sync] Brand extraction: ${withBrand} with brand, ${withoutBrand} without brand, ${protectedIds.size} protected (manual override)`);

      // Log top brands
      const topBrands = Array.from(brandCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([b, c]) => `${b}=${c}`)
        .join(", ");
      console.log(`[equipment-sync] Top brands: ${topBrands}`);

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
        valid_equipment_ids: Array.from(validEquipmentIds),
        categories_found: categories.size,
        new_customers_resolved: customerCache.size,
        brands_detected: withBrand,
        brands_missing: withoutBrand,
        brands_protected: protectedIds.size,
        errors: equipErrors.length > 0 ? equipErrors : undefined,
      };
    }

    // ── Phase 2: Equipment-task relationships ──
    if (phase === "2" || phase === "2-count" || phase === "all") {
      if (!startDateParam || !endDateParam) {
        return new Response(JSON.stringify({
          error: "Phase 2 requires startDate and endDate parameters (YYYY-MM-DD)",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`[equipment-sync] Phase 2${isCountOnly ? " count" : ""}: window ${startDateParam} → ${endDateParam}`);

      if (isCountOnly) {
        phase2Result = {
          window: `${startDateParam} → ${endDateParam}`,
          total_tasks_in_window: await fetchTaskCountForWindow(accessToken, startDateParam, endDateParam),
        };
      } else {
        if (!validEquipmentIds && providedValidEquipmentIds.length > 0) {
          validEquipmentIds = new Set(providedValidEquipmentIds);
          console.log(`[equipment-sync] Valid equipment IDs received from client: ${validEquipmentIds.size}`);
        }

        if (!validEquipmentIds && !skipEquipmentValidation) {
          validEquipmentIds = await loadValidEquipmentIdsFromDb(sb);
          console.log(`[equipment-sync] Valid equipment IDs loaded: ${validEquipmentIds.size}`);
        }

        if (!validEquipmentIds && skipEquipmentValidation) {
          console.log("[equipment-sync] Skipping equipment ID validation for this request");
        }

        const { results: tasksWithEquipments, totalTasks, tasksWithEquipments: withEquipCount } =
          await fetchTasksWithEquipmentsForWindow(accessToken, startDateParam, endDateParam);

        const relRows: any[] = [];
        let discardedLinks = 0;
        const equipmentsWithTasks = new Set<string>();

        for (const task of tasksWithEquipments) {
          if (!task.taskId) continue;
          for (const eqId of task.equipmentIds) {
            if (validEquipmentIds && !validEquipmentIds.has(eqId)) {
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

        let totalRelUpserted = 0;
        const relErrors: string[] = [];

        for (let i = 0; i < relRows.length; i += UPSERT_BATCH_SIZE) {
          const batch = relRows.slice(i, i + UPSERT_BATCH_SIZE);
          const { error } = await sb
            .from("equipamento_tarefas_auvo")
            .upsert(batch, { onConflict: "auvo_equipment_id,auvo_task_id" });
          if (error) {
            relErrors.push(error.message);
            console.error(`[equipment-sync] Rel upsert error: ${error.message}`);
          } else {
            totalRelUpserted += batch.length;
          }
        }

        console.log(`[equipment-sync] Equipment-task relationships upserted: ${totalRelUpserted}`);

        phase2Result = {
          window: `${startDateParam} → ${endDateParam}`,
          total_tasks_in_window: totalTasks,
          tasks_with_equipment_links: withEquipCount,
          relationship_rows_upserted: totalRelUpserted,
          equipments_with_tasks: equipmentsWithTasks.size,
          discarded_invalid_links: discardedLinks,
          errors: relErrors.length > 0 ? relErrors : undefined,
        };
      }
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
