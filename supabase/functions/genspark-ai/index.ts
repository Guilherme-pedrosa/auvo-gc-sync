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
    const messages: any[] = [];

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

      let userPrompt = `Melhore o seguinte texto técnico de um orçamento de serviço:\n\n${text}`;
      if (context) {
        userPrompt += `\n\nContexto adicional do orçamento:\nCliente: ${context.cliente}\nTécnico: ${context.tecnico}\nOrientação: ${context.orientacao || "N/A"}`;
      }

      messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: userPrompt });

    } else if (action === "analyze") {
      systemPrompt = `Você é um engenheiro técnico sênior com 20+ anos de experiência em manutenção industrial, refrigeração, climatização, equipamentos comerciais e industriais.

Você DEVE analisar TODOS os dados fornecidos: texto, contexto, equipamento, fotos (se houver).

Sua análise deve cobrir OBRIGATORIAMENTE:

1. **📋 Resumo do Serviço** - O que está sendo feito, para qual equipamento
2. **🔍 Identificação do Equipamento** - Identifique marca, modelo, tipo do equipamento pelas fotos e/ou descrição. Pesquise sobre as características técnicas desse equipamento específico.
3. **✅ Verificação do Diagnóstico do Técnico** - O diagnóstico do técnico faz sentido técnico? As peças solicitadas são compatíveis com o equipamento identificado? O técnico está correto ou há inconsistências? Aponte qualquer erro ou exagero.
4. **⚠️ Peças Complementares Obrigatórias** - Liste peças que o técnico DEVERIA ter incluído mas não incluiu. Exemplos:
   - Pediu resistência → deveria pedir terminais, cabos, isolamento térmico?
   - Pediu compressor → deveria pedir filtro secador, gás, óleo?
   - Pediu placa eletrônica → deveria pedir fusíveis, conectores?
   - Pediu motor → deveria pedir capacitor, rolamentos, correias?
5. **💰 Análise de Valor** - O valor do orçamento está coerente com o mercado para este tipo de serviço/equipamento?
6. **⚡ Pontos de Atenção e Riscos** - Possíveis problemas, cuidados na execução
7. **🎯 Recomendações Finais** - Sugestões de melhoria, serviços preventivos adicionais
8. **📊 Complexidade** - Baixa/Média/Alta com justificativa

Seja DIRETO, TÉCNICO e CRÍTICO. Se o técnico errou, aponte claramente. Se faltam peças complementares, liste TODAS.
Use formatação com emojis, negrito e tópicos para facilitar a leitura.`;

      // Build user content parts (text + images for vision)
      const userContentParts: any[] = [];

      let textPrompt = `Analise tecnicamente este orçamento:\n\n`;
      if (context) {
        textPrompt += `Cliente: ${context.cliente || "N/A"}\n`;
        textPrompt += `Técnico: ${context.tecnico || "N/A"}\n`;
        textPrompt += `Data: ${context.data_tarefa || "N/A"}\n`;
        textPrompt += `Orientação/Descrição do Serviço: ${context.orientacao || "N/A"}\n\n`;
        if (context.descricao) textPrompt += `Descrição Detalhada: ${context.descricao}\n\n`;
        if (context.pecas) textPrompt += `Peças Solicitadas pelo Técnico:\n${context.pecas}\n\n`;
        if (context.servicos) textPrompt += `Serviços Necessários:\n${context.servicos}\n\n`;
        if (context.tempo) textPrompt += `Tempo para Execução: ${context.tempo}\n\n`;
        if (context.observacoes) textPrompt += `Observações do Técnico:\n${context.observacoes}\n\n`;
        if (context.gc_valor) textPrompt += `Valor Total do Orçamento: R$ ${context.gc_valor}\n`;
        if (context.gc_situacao) textPrompt += `Situação Atual: ${context.gc_situacao}\n`;
        
        // All questionnaire answers for full context
        if (context.todas_respostas) {
          textPrompt += `\nTodas as respostas do questionário do técnico:\n${context.todas_respostas}\n`;
        }
      }

      userContentParts.push({ type: "text", text: textPrompt });

      // Add photos as image_url for GPT vision
      if (context?.fotos && Array.isArray(context.fotos) && context.fotos.length > 0) {
        textPrompt += `\n\n📷 ${context.fotos.length} foto(s) do equipamento/serviço anexadas abaixo. ANALISE CADA FOTO para identificar o equipamento, estado, e verificar a coerência com o diagnóstico do técnico.\n`;
        userContentParts[0] = { type: "text", text: textPrompt };
        
        for (const url of context.fotos.slice(0, 8)) { // max 8 photos
          userContentParts.push({
            type: "image_url",
            image_url: { url, detail: "high" },
          });
        }
      }

      messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: userContentParts });

    } else {
      throw new Error("Ação inválida. Use 'improve' ou 'analyze'.");
    }

    const model = action === "analyze" ? "gpt-4o" : "gpt-4o-mini";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API error:", response.status, errText);
      return new Response(JSON.stringify({ error: `Erro na API OpenAI: ${response.status}` }), {
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
    console.error("openai-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
