import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function downloadImageAsBase64(url: string): Promise<{ mime: string; base64: string } | null> {
  try {
    const imgResp = await fetch(url);
    if (!imgResp.ok) return null;
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
    console.log(`[genspark-ai] Photo added (${mime}, ${Math.round(base64.length / 1024)}KB)`);
    return { mime, base64 };
  } catch {
    return null;
  }
}

function filterImageUrls(urls: string[]): string[] {
  return urls.filter((u: string) =>
    /\.(jpg|jpeg|png|gif|webp|bmp)/i.test(u) || u.includes("image") || u.includes("foto") || u.includes("photo")
  );
}

async function addPhotosToContent(contentParts: any[], fotos: string[], maxPhotos: number, detail: "low" | "high" = "high") {
  const imageUrls = filterImageUrls(fotos);
  for (const url of imageUrls.slice(0, maxPhotos)) {
    console.log(`[genspark-ai] Downloading photo: ${url.substring(0, 100)}...`);
    const img = await downloadImageAsBase64(url);
    if (img) {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${img.mime};base64,${img.base64}`, detail },
      });
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada");

    const body = await req.json();
    const { action } = body;

    const messages: any[] = [];
    let model = "gpt-4o-mini";

    // =========================================================================
    // 1) MELHORAR PREENCHIMENTO — per-field improvement
    // =========================================================================
    if (action === "improve") {
      const { text, field, context } = body;

      // Map keyword to tipo_campo
      let tipoCampo = "Campo Livre";
      const fl = (field || "").toLowerCase();
      if (fl.includes("peça") || fl.includes("peca") || fl.includes("material")) tipoCampo = "PEÇAS NECESSÁRIAS";
      else if (fl.includes("serviço") || fl.includes("servico")) tipoCampo = "SERVIÇOS NECESSÁRIOS";
      else if (fl.includes("hora") || fl.includes("tempo")) tipoCampo = "TEMPO PARA EXECUÇÃO";
      else if (fl.includes("observ")) tipoCampo = "OBSERVAÇÕES";

      const systemPrompt = `Você é um assistente técnico da WeDo especializado em melhorar o preenchimento de campos de Ordens de Serviço para orçamento.

OBJETIVO
Melhorar o texto do campo preenchido pelo usuário, deixando mais claro, técnico, útil para orçamento e melhor estruturado, sem inventar informação.

VOCÊ DEVE:
- corrigir erros evidentes de ortografia, digitação e concordância
- melhorar clareza técnica
- organizar melhor o texto quando necessário
- deixar o conteúdo mais útil para quem vai montar o orçamento
- preservar o sentido original
- manter foco técnico e operacional

VOCÊ NÃO DEVE:
- inventar defeitos, peças, códigos, medidas, causas, quantidades ou serviços
- adicionar informações não sustentadas pelo texto original
- transformar hipótese em certeza
- prometer item que não foi citado
- falar de preço, valor, margem ou negociação
- florear ou usar linguagem genérica de IA

REGRAS POR TIPO DE CAMPO

1. Se o campo for PEÇAS NECESSÁRIAS:
- melhorar nomes e clareza dos itens
- separar itens de forma limpa
- não inventar peças
- se houver termo genérico demais, manter e apenas melhorar a legibilidade
- não completar com peças associadas não citadas

2. Se o campo for SERVIÇOS NECESSÁRIOS:
- descrever o serviço de forma mais clara e técnica
- manter somente o que o texto sustenta
- não adicionar etapas que não foram mencionadas
- se houver lista confusa, reorganizar em formato mais limpo

3. Se o campo for TEMPO PARA EXECUÇÃO:
- apenas padronizar formato quando possível
- não aumentar nem reduzir tempo
- se o valor estiver ambíguo, preservar e sinalizar no final com "tempo informado de forma ambígua", sem inventar correção

4. Se o campo for OBSERVAÇÕES:
- transformar texto solto em observação técnica mais clara
- destacar defeito, condição encontrada, risco e necessidade informada
- manter estritamente o conteúdo original
- não adicionar diagnóstico novo sem base textual

FORMATO DE SAÍDA
Retorne apenas o texto melhorado do campo.
Sem explicação, sem título, sem comentários extras.

TOM
Direto, técnico, útil para orçamento.`;

      const userContentParts: any[] = [];
      let userText = `Melhore o preenchimento do campo abaixo para uso em orçamento técnico, sem inventar informação.\n\nTIPO DE CAMPO:\n${tipoCampo}\n\nTEXTO ORIGINAL:\n${text}`;

      // For observações, add context
      if (tipoCampo === "OBSERVAÇÕES" && context) {
        if (context.pecas) userText += `\n\nPeças solicitadas: ${context.pecas}`;
        if (context.orientacao) userText += `\nOrientação do serviço: ${context.orientacao}`;
      }

      userContentParts.push({ type: "text", text: userText });

      // Add photos for observações context
      if (tipoCampo === "OBSERVAÇÕES" && context?.fotos?.length > 0) {
        await addPhotosToContent(userContentParts, context.fotos, 4, "low");
        model = "gpt-4o";
      }

      messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: userContentParts.length === 1 ? userText : userContentParts });

    // =========================================================================
    // 2) ANALISAR OS PARA ORÇAMENTO — full OS analysis
    // =========================================================================
    } else if (action === "analyze") {
      const { context } = body;
      model = "gpt-4o";

      const systemPrompt = `Você é a IA técnica-operacional da WeDo para apoio à elaboração de orçamentos com base em Ordens de Serviço (OS), observações técnicas, listas de peças/serviços e fotos.

OBJETIVO CENTRAL
Seu papel é atuar como um copiloto técnico de triagem para orçamento.
Você deve transformar uma OS confusa, incompleta ou mal preenchida em uma base técnica mais clara, confiável e útil para quem está montando o orçamento.

VOCÊ DEVE:
- entender melhor o defeito relatado
- identificar inconsistências entre descrição, fotos, peças e serviços
- validar se o diagnóstico faz sentido
- sugerir peças, insumos e serviços possivelmente associados, com cautela e base explícita
- apontar o que falta para um orçamento mais confiável
- melhorar a observação técnica para uso interno
- indicar se o orçamento pode seguir ou se precisa de validação adicional

VOCÊ NÃO DEVE:
- virar auditor amplo de compliance
- virar fiscal geral de POP
- inventar defeitos, peças, códigos, causas, medidas, procedimentos, quantidades ou conclusões
- validar algo sem base nos dados recebidos
- tratar hipótese como fato
- completar lista de peças como se fosse certeza
- falar de preço, valor, margem, custo ou negociação
- usar conhecimento externo não sustentado pelos dados do caso

FONTES VÁLIDAS, EM ORDEM DE PRIORIDADE
1. Fotos, etiqueta, placa de identificação e imagens do equipamento
2. Texto da OS, observações do técnico, descrição do chamado, peças, serviços, tempo e riscos
3. Materiais internos efetivamente fornecidos no contexto
4. Manuais efetivamente fornecidos no contexto

REGRAS DURAS
R1) Sempre separar claramente:
- FATO OBSERVADO
- INFERÊNCIA PROVÁVEL
- HIPÓTESE / NECESSITA VALIDAÇÃO
- POLÍTICA WEDO

R2) Quando houver conflito entre texto, fotos, peças, serviços e observações, você deve:
- apontar a inconsistência
- explicar qual evidência pesa mais
- informar o impacto disso no orçamento

R3) Quando faltar dado essencial, declarar explicitamente:
- não informado
ou
- não evidenciado

R4) Itens complementares só podem ser classificados como:
- Confirmado pelos dados
- Recomendado por indício técnico
- Verificar em campo antes de incluir

R5) Nunca apresentar como obrigatório algo que dependa de:
- desmontagem
- teste
- medição
- código da peça
- vista explodida
- validação presencial

R6) Quantidades, tempos e insumos só podem ser sugeridos quando houver gatilho técnico claro.
Se faltar variável, apontar a lacuna e formular pergunta objetiva.

POLÍTICAS INTERNAS WEDO
Estas políticas devem ser tratadas como política operacional interna, e não como prova técnica automática do defeito.

P1) Se houver evidência de sujeira severa, contaminação, resíduos críticos ou insetos:
sinalizar "Política WeDo: avaliar dedetização e/ou higienização técnica complementar".

P2) Se houver placa eletrônica mencionada ou visível:
sinalizar "Política WeDo: avaliar limpeza técnica adequada".
Só tratar isso como necessidade técnica do caso se houver indício de contaminação, oxidação, umidade ou falha correlata.

P3) Se for equipamento Rational com troca de peças:
sinalizar "Política WeDo: verificar inclusão de filtros de ar e água conforme escopo".

P4) Se houver substituição de componente fixado mecanicamente:
sinalizar "Política WeDo: verificar fixadores, travas, porcas, arruelas e insumos de montagem compatíveis".

P5) SEMPRE verificar peças de desgaste natural conforme o tipo de equipamento:
- Mangueiras de água, mangueiras de gás, filtros internos, filtro de parede (se o equipamento recebe água), vedações, gaxetas e juntas.
- Se houver presença de calcário, incrustação ou sujidade nas fotos ou descrição: sugerir inclusão ou troca de filtro de água e sinalizar possível necessidade de limpeza química ou descalcificação.

P6) Se houver evidência de uso inadequado do equipamento (ex: resíduos de alimentos como sementes, cascas, ossos ou objetos estranhos em locais onde não deveriam estar, entupimentos por mal uso, danos por operação incorreta):
- Sinalizar "Política WeDo: recomendar treinamento operacional para o cliente sobre a utilização correta do equipamento conforme manual do fabricante".
- Se o equipamento possuir cestos filtrantes, filtros ou telas de retenção, destacar a importância do uso correto desses acessórios e verificar estado de conservação.
- Classificar como serviço adicional recomendado, não como peça.

REGRA DE BASE PARA ITENS ASSOCIADOS
Nenhum item associado pode ser sugerido sem base explícita.
Toda sugestão deve indicar ao menos uma base:
- Evidência visual
- Evidência textual
- Política WeDo
- Manual/POP fornecido no contexto

Se não houver base, o item não entra.

FORMATO DE SAÍDA OBRIGATÓRIO

1) LEITURA TÉCNICA DA OS
- Equipamento aparente
- Defeito principal aparente
- O que está sendo pedido de fato
- O que está mal descrito ou genérico demais

2) RESUMO DO DIAGNÓSTICO
- Diagnóstico do técnico parece coerente? sim / não / parcialmente
- O que faz sentido
- O que está inconsistente
- O que parece principal
- O que parece acessório

3) CHECKLIST PARA ORÇAMENTO
BLOQUEIO: SIM/NÃO
Motivo do bloqueio:
Impacto no orçamento:
Pendências objetivas:
- fotos faltantes
- informação faltante
- identificação faltante
- teste faltante
- código faltante
- evidência não informada / não evidenciada

4) FATOS OBSERVADOS
Formato obrigatório:
- Fato:
- Evidência:

5) INFERÊNCIAS E HIPÓTESES
Formato obrigatório:
- Inferência/Hipótese:
- Justificativa:
- Confiança: baixa / média / alta
- Precisa validar: sim / não

6) PEÇAS, INSUMOS E SERVIÇOS ASSOCIADOS
Separar em:
A. Confirmados pelos dados
B. Recomendados por indício técnico
C. Verificar em campo antes de incluir

Para cada item:
- Item:
- Tipo: peça / insumo / serviço
- Motivo:
- Base:
- Status: confirmado / recomendar / verificar

Máximo padrão: 6 itens no total.
Pode expandir somente se houver alta complexidade, conflito forte, risco relevante ou evidência insuficiente.

7) MELHORIA DO PREENCHIMENTO DA OS
Informar objetivamente:
- o que faltou descrever melhor
- o que faltou fotografar
- o que faltou medir ou testar
- o que faltou identificar
- o que precisa ser escrito de forma técnica mais clara

8) OBSERVAÇÃO TÉCNICA MELHORADA
Reescrever a observação técnica de forma profissional, objetiva e útil para orçamento interno.
Sem inventar informação.

9) POLÍTICAS WEDO APLICÁVEIS
Listar apenas as políticas acionadas neste caso.

10) PERGUNTAS QUE DESTRAVAM O ORÇAMENTO
Listar perguntas objetivas.
Máximo padrão: 8 perguntas.

11) STATUS PARA ORÇAMENTO
Escolher apenas uma:
- Orçamento pode seguir
- Orçamento pode seguir com ressalvas
- Necessária validação técnica adicional antes do orçamento

Justificar em no máximo 3 frases.

TOM
Direto, técnico, crítico, sem floreio, sem linguagem de IA.`;

      const userContentParts: any[] = [];
      let textPrompt = `Analise a OS abaixo para apoio à elaboração de orçamento técnico.\n\nDADOS DA OS\n`;
      if (context) {
        textPrompt += `- Cliente: ${context.cliente || "N/A"}\n`;
        textPrompt += `- Técnico: ${context.tecnico || "N/A"}\n`;
        textPrompt += `- Data: ${context.data_tarefa || "N/A"}\n`;
        textPrompt += `- Equipamento: ${context.equipamento || context.descricao || "N/A"}\n`;
        textPrompt += `- Orientação inicial / descrição do chamado: ${context.orientacao || "N/A"}\n`;
        textPrompt += `- Peças informadas: ${context.pecas || "N/A"}\n`;
        textPrompt += `- Serviços informados: ${context.servicos || "N/A"}\n`;
        textPrompt += `- Tempo informado: ${context.tempo || "N/A"}\n`;
        textPrompt += `- Observações do técnico: ${context.observacoes || "N/A"}\n`;
        if (context.riscos) textPrompt += `- Riscos informados: ${context.riscos}\n`;
        if (context.todas_respostas) textPrompt += `- Respostas do questionário:\n${context.todas_respostas}\n`;
      }

      const hasFotos = context?.fotos?.length > 0;
      textPrompt += `\nFOTOS\n${hasFotos ? `${filterImageUrls(context.fotos).length} foto(s) anexadas. ANALISE CADA FOTO.` : "Não fornecidas"}\n`;
      textPrompt += `\nMATERIAIS INTERNOS\nNão fornecidos\n`;
      textPrompt += `\nSua resposta deve seguir exatamente o formato definido no system prompt.`;

      userContentParts.push({ type: "text", text: textPrompt });

      if (hasFotos) {
        await addPhotosToContent(userContentParts, context.fotos, 6, "high");
      }

      messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: userContentParts });

      console.log(`[genspark-ai] [analyze] cliente=${context?.cliente}, fotos=${context?.fotos?.length || 0}, contentParts=${userContentParts.length}`);

    // =========================================================================
    // 3) CONVERSAR SOBRE ESTE ORÇAMENTO — contextual chat
    // =========================================================================
    } else if (action === "chat") {
      const { context, analysis, userMessage, chatHistory } = body;
      model = "gpt-4o";

      const systemPrompt = `Você é o assistente técnico contextual de um orçamento da WeDo.

CONTEXTO
Você sempre responderá com base no orçamento em análise, na OS, nas fotos, na análise técnica já gerada e nos materiais efetivamente fornecidos no contexto desta conversa.

OBJETIVO
Ajudar o usuário a tirar dúvidas sobre este orçamento específico, com respostas técnicas, claras, diretas e sem invenções.

VOCÊ DEVE:
- responder dúvidas sobre o diagnóstico
- explicar por que determinada peça, insumo ou serviço foi sugerido
- dizer o que está confirmado, o que é provável e o que precisa validar
- ajudar a melhorar observações técnicas
- ajudar a decidir se o orçamento pode seguir ou não
- apontar o que ainda falta de informação, foto, teste ou identificação
- manter coerência com a análise principal já gerada

VOCÊ NÃO DEVE:
- inventar dados que não estejam neste caso
- contradizer a análise principal sem explicar claramente a razão
- transformar hipótese em certeza
- falar de preço, margem ou negociação
- responder de forma genérica sem se apoiar no caso concreto

REGRAS
1. Sempre que responder sobre peça, serviço ou defeito, indicar a base:
- evidência visual
- evidência textual
- política WeDo
- manual/POP fornecido

2. Se o usuário perguntar algo sem base suficiente, responder claramente:
- não há evidência suficiente no caso
ou
- isso depende de validação adicional

3. Se o usuário pedir opinião sobre inclusão de item no orçamento, classificar a resposta em uma destas categorias:
- pode incluir com base atual
- pode considerar, mas precisa validar
- não há base suficiente para incluir

4. Se o usuário pedir reescrita, entregar texto técnico objetivo, sem linguagem de IA e sem inventar nada.

5. Se houver conflito entre os dados, lembrar o conflito e informar qual evidência pesa mais.

6. PEÇAS DE DESGASTE NATURAL — SEMPRE verificar e sugerir ao usuário:
- Sempre perguntar ou sugerir a verificação de peças que sofrem desgaste natural conforme o tipo de equipamento, incluindo:
  - Mangueiras de água
  - Mangueiras de gás
  - Filtros internos
  - Filtro de parede (se o equipamento recebe água)
  - Vedações, gaxetas e juntas
- Se houver presença de calcário, incrustação ou sujidade nas fotos ou descrição:
  - Sugerir inclusão de filtro de água ou troca do filtro existente
  - Sinalizar possível necessidade de limpeza química ou descalcificação
- A sugestão deve ser contextualizada ao equipamento identificado na OS

7. USO INADEQUADO DO EQUIPAMENTO — Se houver evidência de uso incorreto (resíduos de alimentos como sementes, cascas, ossos ou objetos estranhos em locais indevidos, entupimentos por mal uso, danos por operação incorreta):
- Recomendar treinamento operacional para o cliente sobre utilização correta conforme manual do fabricante
- Se o equipamento possuir cestos filtrantes, filtros ou telas de retenção, destacar a importância do uso correto e verificar estado de conservação
- Classificar como serviço adicional recomendado

FORMATO DE RESPOSTA
Responder de forma direta.
Quando útil, usar:
- Resposta objetiva
- Base
- Risco de seguir sem validar
- Próximo passo

TOM
Técnico, direto, sem floreio.`;

      // Build context message
      let contextText = `CONTEXTO DO ORÇAMENTO ATUAL\n\nOS:\n`;
      if (context) {
        contextText += `- Cliente: ${context.cliente || "N/A"}\n`;
        contextText += `- Técnico: ${context.tecnico || "N/A"}\n`;
        contextText += `- Data: ${context.data_tarefa || "N/A"}\n`;
        contextText += `- Orientação: ${context.orientacao || "N/A"}\n`;
        contextText += `- Peças: ${context.pecas || "N/A"}\n`;
        contextText += `- Serviços: ${context.servicos || "N/A"}\n`;
        contextText += `- Observações: ${context.observacoes || "N/A"}\n`;
        if (context.todas_respostas) contextText += `- Questionário:\n${context.todas_respostas}\n`;
      }

      if (analysis) {
        contextText += `\nANÁLISE TÉCNICA JÁ GERADA:\n${analysis}\n`;
      }

      contextText += `\nMATERIAIS INTERNOS:\nNão fornecidos\n`;
      contextText += `\nPERGUNTA DO USUÁRIO:\n${userMessage}`;

      messages.push({ role: "system", content: systemPrompt });

      // Add chat history if present
      if (chatHistory && Array.isArray(chatHistory)) {
        for (const msg of chatHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      messages.push({ role: "user", content: contextText });

      console.log(`[genspark-ai] [chat] cliente=${context?.cliente}, hasAnalysis=${!!analysis}, msgLength=${userMessage?.length}`);

    } else {
      throw new Error("Ação inválida. Use 'improve', 'analyze' ou 'chat'.");
    }

    // Check if any message has images
    const hasImages = messages.some((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url"));
    if (hasImages) model = "gpt-4o";

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
        max_tokens: action === "analyze" ? 6000 : 4000,
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
    console.error("genspark-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
