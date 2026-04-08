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

interface AuvoEquipment {
  id: number;
  name: string;
  identifier: string;
  description: string;
  associatedCustomerId: number;
  categoryId: number;
  active: boolean;
  externalId: string;
  creationDate: string;
  expirationDate: string;
}

// Fetch ALL equipment from Auvo paginated
async function fetchAllEquipments(token: string): Promise<AuvoEquipment[]> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const allEquipments: AuvoEquipment[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const paramFilter = JSON.stringify({});
    const url = `${AUVO_BASE_URL}/equipments/?paramFilter=${encodeURIComponent(paramFilter)}&page=${page}&pageSize=${pageSize}&order=asc`;
    const res = await fetch(url, { method: "GET", headers });

    if (!res.ok) {
      // If 403 rate limit, wait and retry
      if (res.status === 403) {
        console.log("Rate limit hit, waiting 15s...");
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
      throw new Error(`Auvo equipments fetch failed (${res.status}): ${await res.text()}`);
    }

    const data = await res.json();
    const list = data?.result?.entityList;
    if (!list || list.length === 0) break;

    allEquipments.push(...list);

    const totalItems = data?.result?.pagedSearchReturnData?.totalItems || 0;
    console.log(`Page ${page}: got ${list.length} equipments (total: ${totalItems})`);

    if (allEquipments.length >= totalItems) break;
    page++;
  }

  return allEquipments;
}

// Fetch customer name by ID (with cache)
async function fetchCustomerName(customerId: number, token: string, cache: Map<number, string>): Promise<string | null> {
  if (customerId <= 0) return null;
  if (cache.has(customerId)) return cache.get(customerId)!;

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    const res = await fetch(`${AUVO_BASE_URL}/customers/${customerId}`, { method: "GET", headers });
    if (res.status === 403) {
      // Rate limit - wait and retry once
      await new Promise(r => setTimeout(r, 15000));
      const retry = await fetch(`${AUVO_BASE_URL}/customers/${customerId}`, { method: "GET", headers });
      if (!retry.ok) return null;
      const d = await retry.json();
      const name = d?.result?.description || null;
      if (name) cache.set(customerId, name);
      return name;
    }
    if (!res.ok) return null;
    const d = await res.json();
    const name = d?.result?.description || null;
    if (name) cache.set(customerId, name);
    return name;
  } catch {
    return null;
  }
}

// Fetch equipment categories (with cache)
async function fetchAllCategories(token: string): Promise<Map<number, string>> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const catMap = new Map<number, string>();
  let page = 1;

  while (true) {
    const paramFilter = JSON.stringify({});
    const url = `${AUVO_BASE_URL}/equipmentCategories/?paramFilter=${encodeURIComponent(paramFilter)}&page=${page}&pageSize=100&order=asc`;
    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) break;
    const data = await res.json();
    const list = data?.result?.entityList;
    if (!list || list.length === 0) break;
    for (const cat of list) {
      catMap.set(cat.id, cat.description);
    }
    const totalItems = data?.result?.pagedSearchReturnData?.totalItems || 0;
    if (catMap.size >= totalItems) break;
    page++;
  }

  return catMap;
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

    // Fetch all equipment from Auvo API
    console.log("Fetching all equipments from Auvo API...");
    const auvoEquipments = await fetchAllEquipments(accessToken);
    console.log(`Total equipments from Auvo: ${auvoEquipments.length}`);

    // Fetch categories
    console.log("Fetching equipment categories...");
    const categories = await fetchAllCategories(accessToken);

    // Collect unique customer IDs to resolve
    const customerIds = new Set<number>();
    for (const eq of auvoEquipments) {
      if (eq.associatedCustomerId > 0) customerIds.add(eq.associatedCustomerId);
    }
    console.log(`Unique customers to resolve: ${customerIds.size}`);

    // Resolve customer names (batch with cache)
    const customerCache = new Map<number, string>();
    let resolved = 0;
    for (const cid of customerIds) {
      await fetchCustomerName(cid, accessToken, customerCache);
      resolved++;
      // Small delay to avoid rate limiting (400 req/min)
      if (resolved % 50 === 0) {
        console.log(`Resolved ${resolved}/${customerIds.size} customers`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    console.log(`Resolved ${customerCache.size} customer names`);

    // Fetch existing equipment from DB
    const { data: existing } = await sb.from("equipamentos_auvo").select("id, auvo_equipment_id, nome, identificador, cliente, categoria");
    const existingMap = new Map<string, any>();
    for (const e of existing || []) {
      if (e.auvo_equipment_id) {
        existingMap.set(e.auvo_equipment_id, e);
      }
    }

    let inserted = 0;
    let updated = 0;

    for (const eq of auvoEquipments) {
      const auvoId = String(eq.id);
      const nome = eq.name?.trim() || "";
      const identificador = eq.identifier?.trim() || null;
      const descricao = eq.description?.trim() || null;
      const cliente = eq.associatedCustomerId > 0
        ? customerCache.get(eq.associatedCustomerId) || null
        : null;
      const categoria = eq.categoryId > 0
        ? categories.get(eq.categoryId) || null
        : null;
      const status = eq.active ? "Ativo" : "Inativo";

      const existingRow = existingMap.get(auvoId);

      if (!existingRow) {
        // Insert new
        const { error } = await sb.from("equipamentos_auvo").insert({
          auvo_equipment_id: auvoId,
          nome,
          identificador,
          descricao,
          cliente,
          categoria,
          status,
        });
        if (!error) inserted++;
      } else {
        // Update if data changed
        const updates: Record<string, any> = {};
        if (nome && existingRow.nome !== nome) updates.nome = nome;
        if (cliente && existingRow.cliente !== cliente) updates.cliente = cliente;
        if (categoria && existingRow.categoria !== categoria) updates.categoria = categoria;
        if (identificador && existingRow.identificador !== identificador) updates.identificador = identificador;

        if (Object.keys(updates).length > 0) {
          updates.atualizado_em = new Date().toISOString();
          await sb.from("equipamentos_auvo").update(updates).eq("id", existingRow.id);
          updated++;
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_auvo: auvoEquipments.length,
      existing_db: existingMap.size,
      inserted,
      updated,
      categories_found: categories.size,
      customers_resolved: customerCache.size,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("equipment-sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
