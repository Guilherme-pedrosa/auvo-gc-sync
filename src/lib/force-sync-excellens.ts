import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUVO_APP_KEY = Deno.env.get("AUVO_APP_KEY") ?? "";
const AUVO_TOKEN = Deno.env.get("AUVO_TOKEN") ?? "";
const AUVO_BASE = "https://api.auvo.com.br/v2";

async function forceSyncExcellens() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  // 1. Login Auvo
  console.log("Fazendo login no Auvo...");
  const loginResp = await fetch(
    `${AUVO_BASE}/login/?apiKey=${encodeURIComponent(AUVO_APP_KEY)}&apiToken=${encodeURIComponent(AUVO_TOKEN)}`,
    { headers: { "Content-Type": "application/json" } }
  );
  const loginData = await loginResp.json();
  const token = loginData?.result?.accessToken;
  if (!token) {
    console.error("Falha no login Auvo");
    return;
  }

  // 2. Buscar cliente Excellens no Auvo para ver o nome atual
  console.log("Buscando cliente 17507410 no Auvo...");
  const custResp = await fetch(`${AUVO_BASE}/customers/17507410`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
  });
  const custData = await custResp.json();
  const auvoName = custData?.result?.name || custData?.name;
  console.log(`Nome no Auvo: "${auvoName}"`);

  if (!auvoName) {
    console.error("Não foi possível obter o nome do Auvo");
    return;
  }

  // 3. Atualizar no Banco de Dados
  console.log("Atualizando rh_clientes...");
  const { error: err1 } = await supabase
    .from("rh_clientes")
    .update({ 
      nome_auvo: auvoName,
      auvo_sync_em: new Date().toISOString()
    })
    .eq("auvo_cliente_id", 17507410);
  
  if (err1) console.error("Erro ao atualizar rh_clientes:", err1);
  else console.log("rh_clientes atualizado.");

  console.log("Atualizando auvo_clientes_cache...");
  const { error: err2 } = await supabase
    .from("auvo_clientes_cache")
    .update({ 
      nome: auvoName,
      atualizado_em: new Date().toISOString()
    })
    .eq("auvo_id", 17507410);

  if (err2) console.error("Erro ao atualizar auvo_clientes_cache:", err2);
  else console.log("auvo_clientes_cache atualizado.");
  
  console.log("Sincronização forçada concluída.");
}

forceSyncExcellens();
