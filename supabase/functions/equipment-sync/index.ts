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

async function fetchAllEquipments(token: string): Promise<any[]> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const allEquipments: any[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const url = `${AUVO_BASE_URL}/equipments/?paramFilter=${encodeURIComponent("{}")}&page=${page}&pageSize=${pageSize}&order=asc`;
    const res = await fetch(url, { method: "GET", headers });

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        console.log(`Rate limit hit (${res.status}), waiting 20s...`);
        await new Promise(r => setTimeout(r, 20000));
        continue;
      }
      throw new Error(`Auvo equipments fetch failed (${res.status})`);
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

async function fetchCustomerName(customerId: number, token: string, cache: Map<number, string>): Promise<string | null> {
  if (customerId <= 0) return null;
  if (cache.has(customerId)) return cache.get(customerId)!;

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    let res = await fetch(`${AUVO_BASE_URL}/customers/${customerId}`, { method: "GET", headers });
    if (res.status === 403) {
      await new Promise(r => setTimeout(r, 15000));
      res = await fetch(`${AUVO_BASE_URL}/customers/${customerId}`, { method: "GET", headers });
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

async function fetchAllCategories(token: string): Promise<Map<number, string>> {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const catMap = new Map<number, string>();
  let page = 1;

  while (true) {
    const url = `${AUVO_BASE_URL}/equipmentCategories/?paramFilter=${encodeURIComponent("{}")}&page=${page}&pageSize=100&order=asc`;
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

    // 1. Fetch all equipment from Auvo API
    console.log("Fetching all equipments from Auvo API...");
    const auvoEquipments = await fetchAllEquipments(accessToken);
    console.log(`Total equipments from Auvo: ${auvoEquipments.length}`);

    // 2. Fetch categories
    console.log("Fetching equipment categories...");
    const categories = await fetchAllCategories(accessToken);

    // 3. Resolve customer names
    const customerIds = new Set<number>();
    for (const eq of auvoEquipments) {
      if (eq.associatedCustomerId > 0) customerIds.add(eq.associatedCustomerId);
    }
    console.log(`Unique customers to resolve: ${customerIds.size}`);

    const customerCache = new Map<number, string>();
    let resolved = 0;
    for (const cid of customerIds) {
      await fetchCustomerName(cid, accessToken, customerCache);
      resolved++;
      if (resolved % 50 === 0) {
        console.log(`Resolved ${resolved}/${customerIds.size} customers`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    console.log(`Resolved ${customerCache.size} customer names`);

    // 4. Prepare all rows for batch upsert
    const rows = auvoEquipments.map(eq => {
      const auvoId = String(eq.id);
      return {
        auvo_equipment_id: auvoId,
        nome: eq.name?.trim() || "",
        identificador: eq.identifier?.trim() || null,
        descricao: eq.description?.trim() || null,
        cliente: eq.associatedCustomerId > 0
          ? customerCache.get(eq.associatedCustomerId) || null
          : null,
        categoria: eq.categoryId > 0
          ? categories.get(eq.categoryId) || null
          : null,
        status: eq.active ? "Ativo" : "Inativo",
        atualizado_em: new Date().toISOString(),
      };
    });

    // 5. Batch upsert in chunks of 500
    const BATCH_SIZE = 500;
    let totalUpserted = 0;
    let errors: string[] = [];

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await sb
        .from("equipamentos_auvo")
        .upsert(batch, { onConflict: "auvo_equipment_id" });

      if (error) {
        console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
        errors.push(error.message);
      } else {
        totalUpserted += batch.length;
      }
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)}: ${batch.length} rows`);
    }

    return new Response(JSON.stringify({
      success: true,
      total_auvo: auvoEquipments.length,
      upserted: totalUpserted,
      categories_found: categories.size,
      customers_resolved: customerCache.size,
      errors: errors.length > 0 ? errors : undefined,
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
