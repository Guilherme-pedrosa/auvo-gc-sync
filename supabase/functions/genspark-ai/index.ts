import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada");

    const { action, text, context } = await req.json();

    let systemPrompt = "";
    let userPrompt = "";

    if (action === "improve") {
      systemPrompt = `Você é um engenheiro técnico especializado em manutenção industrial, refrigeração, climatização e equipamentos comerciais/industriais. 
Sua tarefa é melhorar o texto fornecido pelo técnico de campo, tornando-o mais:
- Técnico e profissional
- Detalhado e explicativo
- Organizado e bem formatado
- Mantendo TODAS as informações originais
- Adicionando termos técnicos corretos quando possível
- Corrigindo erros de português

Retorne APENAS o texto melhorado, sem explicações adicionais. Mantenha o mesmo formato (lista, parágrafo etc).`;
      userPrompt = `Melhore o seguinte texto técnico de um orçamento de serviço:\n\n${text}`;
      if (context) {
        userPrompt += `\n\nContexto adicional do orçamento:\nCliente: ${context.cliente}\nTécnico: ${context.tecnico}\nOrientação: ${context.orientacao || "N/A"}`;
      }
    } else if (action === "analyze") {
      systemPrompt = `Você é um engenheiro técnico sênior especializado em manutenção industrial, refrigeração, climatização e equipamentos.
Analise os dados do orçamento e forneça uma análise técnica completa incluindo:

1. **Resumo do Serviço** - O que está sendo feito
2. **Diagnóstico Técnico** - Análise das peças e serviços listados  
3. **Pontos de Atenção** - Possíveis riscos ou cuidados adicionais
4. **Recomendações** - Sugestões de melhoria ou serviços complementares
5. **Estimativa de Complexidade** - Baixa/Média/Alta com justificativa

Seja objetivo e técnico. Use formatação com negrito e tópicos.`;
      userPrompt = `Analise tecnicamente este orçamento:\n\n`;
      if (context) {
        userPrompt += `Cliente: ${context.cliente}\nTécnico: ${context.tecnico}\nData: ${context.data_tarefa}\nOrientação: ${context.orientacao || "N/A"}\n\n`;
        if (context.pecas) userPrompt += `Peças Necessárias:\n${context.pecas}\n\n`;
        if (context.servicos) userPrompt += `Serviços Necessários:\n${context.servicos}\n\n`;
        if (context.tempo) userPrompt += `Tempo para Execução:\n${context.tempo}\n\n`;
        if (context.observacoes) userPrompt += `Observações:\n${context.observacoes}\n\n`;
        if (context.gc_valor) userPrompt += `Valor Total: R$ ${context.gc_valor}\n`;
        if (context.gc_situacao) userPrompt += `Situação: ${context.gc_situacao}\n`;
      }
    } else {
      throw new Error("Ação inválida. Use 'improve' ou 'analyze'.");
    }

    const response = await fetch("https://api.genspark.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GENSPARK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Genspark API error:", response.status, errText);
      return new Response(JSON.stringify({ error: `Erro na API Genspark: ${response.status}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const result = data.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("genspark-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
