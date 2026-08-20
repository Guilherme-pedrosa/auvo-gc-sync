import { supabase } from "@/integrations/supabase/client";

async function updateForecast() {
  const { data, error } = await supabase
    .from("agenda_agendamentos")
    .update({
      previsao_detalhes: "kd a desgraça da previsão da merda da porra desse orçamento seu desgraçado?\n\nVeja o link da imagem enviada abaixo e analise o conteúdo dela para responder:\nImagem 1: https://sorax.lovable.app/api/public/i/ik6fm9lrb4.png"
    })
    .eq("id", "eb205d47-0a41-4ae2-96a6-ba56e3c21ab6");
    
  if (error) {
    console.error("Error updating forecast:", error);
  } else {
    console.log("Forecast updated successfully");
  }
}

updateForecast();
