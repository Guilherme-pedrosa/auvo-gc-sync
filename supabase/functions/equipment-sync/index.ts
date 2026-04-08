import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AUVO_BASE_URL = "https://api.auvo.com.br/v2";
const EQUIPMENT_KEYWORDS = [
  "rational", "pratica", "prática", "klimaquip", "klimakiip",
  "genesis", "gênesis", "unox", "câmara fria", "camara fria",
  "câmara refrigerada", "camara refrigerada", "câmara resfriada", "camara resfriada",
  "área climatizada", "area climatizada", "adega",
  "ivario", "ivariopro", "forno combinado", "miniconv",
];

function matchesKeywords(name: string): boolean {
  const lower = name.toLowerCase();
  return EQUIPMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

async function auvoLogin(apiKey: string, apiToken: string): Promise<string> {
  const url = `${AUVO_BASE_URL}/login/?apiKey=${encodeURIComponent(apiKey)}&apiToken=${encodeURIComponent(apiToken)}`;
  const res = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Auvo login failed (${res.status})`);
  const data = await res.json();
  const token = data?.result?.accessToken;
  if (!token) throw new Error("Auvo login: no accessToken");
  return token;
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
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    // Fetch all tasks that have equipment info from tarefas_central
    let allTasks: any[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await sb
        .from("tarefas_central")
        .select("equipamento_nome, equipamento_id_serie, cliente, data_tarefa, tecnico, auvo_link, auvo_task_id")
        .not("equipamento_nome", "is", null)
        .neq("equipamento_nome", "")
        .order("data_tarefa", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allTasks.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Filter by keywords and deduplicate by name+serie
    const filtered = allTasks.filter((r) => matchesKeywords(r.equipamento_nome));
    const equipMap = new Map<string, any>();
    for (const row of filtered) {
      const key = `${(row.equipamento_nome || "").trim().toLowerCase()}|||${(row.equipamento_id_serie || "").trim().toLowerCase()}`;
      if (!equipMap.has(key)) {
        equipMap.set(key, {
          nome: row.equipamento_nome?.trim(),
          identificador: row.equipamento_id_serie?.trim() || null,
          cliente: row.cliente?.trim() || null,
        });
      } else if (!equipMap.get(key).cliente && row.cliente) {
        equipMap.get(key).cliente = row.cliente.trim();
      }
    }

    // Also fetch existing equipment from the table
    const { data: existing } = await sb.from("equipamentos_auvo").select("nome, identificador");
    const existingSet = new Set<string>();
    for (const e of existing || []) {
      existingSet.add(`${(e.nome || "").trim().toLowerCase()}|||${(e.identificador || "").trim().toLowerCase()}`);
    }

    // Insert only new equipment not already in table
    let inserted = 0;
    for (const [key, eq] of equipMap) {
      if (!existingSet.has(key)) {
        const { error } = await sb.from("equipamentos_auvo").insert({
          nome: eq.nome,
          identificador: eq.identificador,
          cliente: eq.cliente,
          status: "Ativo",
        });
        if (!error) inserted++;
      }
    }

    // Update client names from task data where equipment registry has no client
    const { data: noClient } = await sb
      .from("equipamentos_auvo")
      .select("id, nome, identificador")
      .or("cliente.is.null,cliente.eq.");
    
    let updated = 0;
    for (const eq of noClient || []) {
      const key = `${(eq.nome || "").trim().toLowerCase()}|||${(eq.identificador || "").trim().toLowerCase()}`;
      const taskMatch = equipMap.get(key);
      if (taskMatch?.cliente) {
        await sb.from("equipamentos_auvo").update({ cliente: taskMatch.cliente, atualizado_em: new Date().toISOString() }).eq("id", eq.id);
        updated++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_from_tasks: equipMap.size,
      existing: existingSet.size,
      inserted,
      clients_updated: updated,
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
