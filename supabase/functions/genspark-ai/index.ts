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

    const { action, text, context, field } = await req.json();

    let systemPrompt = "";
    const messages: any[] = [];

    if (action === "improve") {
      const isObservacao = field && field.toLowerCase().includes("observ");
      
      if (isObservacao) {
        // Observações: melhoria técnica usando contexto de peças e equipamento
        systemPrompt = `Você é um técnico especializado em manutenção industrial, refrigeração, climatização e equipamentos.
Sua tarefa é melhorar TECNICAMENTE a observação do técnico de campo:
- Manter a informação original como base
- Usar termos técnicos corretos e precisos
- Enriquecer com detalhes técnicos relevantes baseado nas peças solicitadas e no contexto do equipamento
- Ser cauteloso e preciso na descrição técnica
- Corrigir erros de ortografia e gramática
- NÃO adicionar cabeçalhos, títulos ou formatação extra
- NÃO inventar problemas que não foram mencionados
- Manter formato conciso de observação técnica
- Retornar APENAS o texto melhorado`;

        const userContentParts: any[] = [];
        let userText = `Melhore tecnicamente esta observação do técnico:\n\n"${text}"`;
        if (context?.pecas) userText += `\n\nPeças solicitadas pelo técnico: ${context.pecas}`;
        if (context?.orientacao) userText += `\nOrientação do serviço: ${context.orientacao}`;
        
        userContentParts.push({ type: "text", text: userText });

        // Add photos for visual context if available
        if (context?.fotos && Array.isArray(context.fotos) && context.fotos.length > 0) {
          const imageUrls = context.fotos.filter((u: string) =>
            /\.(jpg|jpeg|png|gif|webp|bmp)/i.test(u) || u.includes("image") || u.includes("foto") || u.includes("photo")
          );
          for (const url of imageUrls.slice(0, 4)) {
            try {
              const imgResp = await fetch(url);
              if (!imgResp.ok) continue;
              const arrayBuf = await imgResp.arrayBuffer();
              const bytes = new Uint8Array(arrayBuf);
              let mime = "image/jpeg";
              if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = "image/png";
              else if (bytes[0] === 0xFF && bytes[1] === 0xD8) mime = "image/jpeg";
              else if (bytes[0] === 0x47 && bytes[1] === 0x49) mime = "image/gif";
              else if (bytes[0] === 0x52 && bytes[1] === 0x49) mime = "image/webp";
              let binary = "";
              for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
              const base64 = btoa(binary);
              userContentParts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "low" } });
            } catch { /* skip */ }
          }
        }

        messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: userContentParts });
      } else {
        // Outros campos: apenas correção ortográfica e técnica
        systemPrompt = `Você é um técnico especializado em manutenção industrial, refrigeração, climatização e equipamentos.
Sua ÚNICA tarefa é corrigir o texto fornecido:
- Corrigir erros de ortografia e gramática
- Corrigir termos técnicos incorretos
- NÃO adicionar informações novas
- NÃO adicionar cabeçalhos, títulos ou formatação extra
- NÃO adicionar contexto como nome de cliente, técnico etc
- Manter EXATAMENTE o mesmo formato e estrutura do original
- Retornar APENAS o texto corrigido, nada mais`;

        messages.push({ role: "system", content: systemPrompt });
        messages.push({ role: "user", content: `Corrija o texto abaixo (apenas ortografia e termos técnicos, sem adicionar nada):\n\n${text}` });
      }

    } else if (action === "analyze") {
      systemPrompt = `Você é um engenheiro técnico sênior com 20+ anos de experiência em manutenção industrial, refrigeração, climatização, equipamentos comerciais e industriais.

Você DEVE analisar TODOS os dados fornecidos: texto, contexto, equipamento, fotos (se houver).

Sua análise deve cobrir OBRIGATORIAMENTE:

1. **📋 Resumo do Serviço** - O que está sendo feito, para qual equipamento
2. **🔍 Identificação do Equipamento** - Identifique marca, modelo, tipo do equipamento pelas fotos e/ou descrição. Comente características técnicas relevantes.
3. **✅ Verificação do Diagnóstico do Técnico** - O diagnóstico faz sentido? As peças são compatíveis com o equipamento? O técnico está correto ou há inconsistências? Aponte erros ou exageros.
4. **⚠️ Peças Complementares** - Liste peças que o técnico DEVERIA ter incluído mas não incluiu. Exemplos:
   - Pediu resistência → deveria pedir terminais, cabos, isolamento térmico?
   - Pediu compressor → deveria pedir filtro secador, gás, óleo?
   - Pediu placa eletrônica → deveria pedir fusíveis, conectores?
   - Pediu motor → deveria pedir capacitor, rolamentos, correias?
5. **⚡ Pontos de Atenção e Riscos** - Cuidados na execução
6. **🎯 Recomendações** - Sugestões de melhoria ou serviços preventivos
7. **📊 Complexidade** - Baixa/Média/Alta com justificativa

REGRAS ESPECIAIS OBRIGATÓRIAS:
- Se houver QUALQUER menção a sujidade, sujeira, acúmulo de gordura, insetos, baratas, formigas ou pragas: SEMPRE recomendar DEDETIZAÇÃO do local/equipamento.
- Se o equipamento possuir PLACA ELETRÔNICA (placa de controle, placa principal, controlador digital, etc.): SEMPRE recomendar LIMPEZA POR CAVITAÇÃO da placa eletrônica.

NÃO faça análise de valor/preço.
Seja DIRETO, TÉCNICO e CRÍTICO. Se o técnico errou, aponte. Se faltam peças, liste TODAS.
Use emojis, negrito e tópicos.`;

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

      // Add photos as base64 for GPT vision (OpenAI can't always fetch external URLs)
      if (context?.fotos && Array.isArray(context.fotos) && context.fotos.length > 0) {
        // Filter only URLs that look like images
        const imageUrls = context.fotos.filter((u: string) => 
          /\.(jpg|jpeg|png|gif|webp|bmp)/i.test(u) || u.includes("image") || u.includes("foto") || u.includes("photo")
        );
        
        if (imageUrls.length > 0) {
          textPrompt += `\n\n📷 ${imageUrls.length} foto(s) do equipamento/serviço anexadas. ANALISE CADA FOTO para identificar o equipamento, estado, e verificar a coerência com o diagnóstico do técnico.\n`;
          userContentParts[0] = { type: "text", text: textPrompt };
          
          for (const url of imageUrls.slice(0, 6)) {
            try {
              console.log(`[analyze] Downloading photo: ${url.substring(0, 100)}...`);
              const imgResp = await fetch(url);
              if (!imgResp.ok) {
                console.warn(`[analyze] Failed to download photo: ${imgResp.status}`);
                continue;
              }
              
              const rawCt = imgResp.headers.get("content-type") || "";
              // Force a valid image MIME - many servers return wrong content-type
              let mime = "image/jpeg";
              if (rawCt.includes("png")) mime = "image/png";
              else if (rawCt.includes("webp")) mime = "image/webp";
              else if (rawCt.includes("gif")) mime = "image/gif";
              
              const arrayBuf = await imgResp.arrayBuffer();
              const bytes = new Uint8Array(arrayBuf);
              
              // Detect actual format from magic bytes
              if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = "image/png";
              else if (bytes[0] === 0xFF && bytes[1] === 0xD8) mime = "image/jpeg";
              else if (bytes[0] === 0x47 && bytes[1] === 0x49) mime = "image/gif";
              else if (bytes[0] === 0x52 && bytes[1] === 0x49) mime = "image/webp";
              
              let binary = "";
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              const dataUrl = `data:${mime};base64,${base64}`;
              
              userContentParts.push({
                type: "image_url",
                image_url: { url: dataUrl, detail: "high" },
              });
              console.log(`[analyze] Photo added (${mime}, ${Math.round(base64.length / 1024)}KB)`);
            } catch (imgErr) {
              console.warn(`[analyze] Error downloading photo: ${imgErr}`);
            }
          }
        }
      }

      messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: userContentParts });

      const numFotos = context?.fotos?.length || 0;
      console.log(`[analyze] cliente=${context?.cliente}, fotos=${numFotos}, contentParts=${userContentParts.length}`);

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
