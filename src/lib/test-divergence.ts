import { supabase } from "@/integrations/supabase/client";
import { areNamesDivergent } from "./clientMatching";

async function checkExcellensDivergence() {
  const { data: rh } = await supabase
    .from("rh_clientes")
    .select("nome_gc, nome_auvo, vinculo_status")
    .ilike("nome", "%EXCELLENS ALIMENTACAO FILIAL AMBEV%");
  
  if (!rh || rh.length === 0) {
    console.log("Cliente não encontrado.");
    return;
  }

  const c = rh[0];
  const nameA = c.nome_auvo;
  const nameB = c.nome_gc || "EXCELLENS ALIMENTACAO FILIAL AMBEV"; // nome_gc estava null no query anterior
  
  const divergent = areNamesDivergent(nameA, nameB);
  console.log(`Divergente: ${divergent}`);
  console.log(`Nome Auvo: ${nameA}`);
  console.log(`Nome GC: ${nameB}`);
}

checkExcellensDivergence();
