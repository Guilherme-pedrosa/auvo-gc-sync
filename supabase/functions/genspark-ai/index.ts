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
// =========================================================================
// PERPLEXITY WEB SEARCH — pesquisa técnica na internet sobre o equipamento
// =========================================================================
async function searchEquipmentOnWeb(equipamento: string, descricao: string, orientacao: string, pecas: string): Promise<string> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    console.log("[genspark-ai] PERPLEXITY_API_KEY não disponível, pulando pesquisa web");
    return "";
  }

  const equipClean = (equipamento || "").replace(/n\/a/gi, "").trim();
  const descClean = (descricao || "").replace(/n\/a/gi, "").trim();
  const oriClean = (orientacao || "").replace(/n\/a/gi, "").trim();
  const pecasClean = (pecas || "").replace(/n\/a/gi, "").trim();

  if (!equipClean && !descClean) {
    console.log("[genspark-ai] Sem equipamento/descrição para pesquisar");
    return "";
  }

  const searchQuery = `Equipamento industrial/comercial: "${equipClean || descClean}".
Problema reportado: ${oriClean || "manutenção geral"}.
Peças mencionadas: ${pecasClean || "não informadas"}.

Preciso saber:
1. Especificações técnicas deste equipamento (componentes principais, subsistemas)
2. Problemas mais comuns e causas raiz típicas
3. Lista de peças de desgaste e consumíveis específicos deste modelo
4. Pontos críticos de manutenção preventiva
5. Insumos e ferramentas específicas para este tipo de equipamento`;

  try {
    console.log(`[genspark-ai] Pesquisando Perplexity: "${(equipClean || descClean).substring(0, 80)}..."`);
    
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: "Você é um engenheiro de manutenção industrial. Responda em português brasileiro de forma técnica e objetiva. Foque em dados concretos: especificações, peças, componentes, problemas comuns. Sem floreios."
          },
          { role: "user", content: searchQuery }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[genspark-ai] Perplexity error ${response.status}: ${errText.substring(0, 200)}`);
      return "";
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "";
    const citations = data.citations || [];

    console.log(`[genspark-ai] Perplexity respondeu: ${answer.length} chars, ${citations.length} fontes`);

    let result = `PESQUISA WEB (fontes reais da internet):\n${answer}`;
    if (citations.length > 0) {
      result += `\n\nFONTES: ${citations.slice(0, 5).join(", ")}`;
    }
    return result;
  } catch (e) {
    console.error("[genspark-ai] Perplexity search failed:", e);
    return "";
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

      const systemPrompt = `Você é o engenheiro técnico sênior da WeDo. Analise OS para orçamento.

MISSÃO: Diagnóstico técnico preciso + lista COMPLETA de tudo que precisa para executar o serviço.

REGRA #1 — SEJA OBJETIVO. Frases curtas. Sem floreio. Sem repetição. Sem linguagem de IA.
REGRA #2 — PENSE NO EQUIPAMENTO COMPLETO. Para cada equipamento identificado, pense em TODOS os componentes mecânicos, elétricos e de desgaste que compõem aquele equipamento. Se o técnico pediu troca de rolamento, o que mais naquela máquina pode estar comprometido? Motor? Correia? Selo? Eixo? Acoplamento? LISTE TUDO que deve ser VERIFICADO ou SUBSTITUÍDO.
REGRA #3 — NÃO INVENTE DEFEITOS. Só trabalhe com o que está nos dados e fotos. Mas RECOMENDE verificações em componentes adjacentes.
REGRA #4 — Separe FATO de INFERÊNCIA de HIPÓTESE.
REGRA #5 — Nunca fale de preço/valor/margem.
REGRA #6 — NÃO LISTE EPIs BÁSICOS. Luvas, óculos de proteção, capacete e sapato de segurança são fornecidos pela empresa e NÃO devem aparecer na lista. Só liste EPIs ESPECÍFICOS para aquele serviço (ex: máscara PFF2 para gás refrigerante, protetor auricular para martelete, avental químico para ácido).

RACIOCÍNIO DE COMPONENTES ADJACENTES (OBRIGATÓRIO):
Quando identificar o equipamento, PENSE nos subsistemas:
- Máquina com MOTOR → verificar: correia, polias, rolamentos do motor, capacitor, protetor térmico, ventilador
- Máquina com BOMBA → verificar: selo mecânico, gaxetas, rolamentos, acoplamento, eixo, impulsor
- Máquina com COMPRESSOR → verificar: válvulas, pressostato, capacitor, relé, gás, óleo, filtro secador, ventilador do condensador
- Máquina com RESISTÊNCIA → verificar: terminais, conectores, termostato, fusível térmico, fiação
- Máquina com ROLAMENTOS → verificar: eixo (folga/desgaste), retentor, mancal, lubrificante, correia (se houver)
- Máquina com REDUTOR → verificar: engrenagens, rolamentos, óleo, retentores, acoplamento
- Máquina com CORREIA → verificar: polias (desgaste/alinhamento), tensor, rolamentos dos eixos
- Máquina com ELETROVÁLVULA → verificar: bobina, vedações, filtro de linha, conexões
- Equipamento de REFRIGERAÇÃO → verificar: carga de gás, teste de vazamento, limpeza do condensador, dreno, isolamento térmico

TABELA DE INSUMOS OBRIGATÓRIOS POR CONTEXTO:

Compressor → gás refrigerante (tipo conforme etiqueta), óleo lubrificante, válvula de serviço, tubo de cobre, solda prata, fluxo de solda, nitrogênio para pressurização, filtro secador, MÁSCARA PFF2
Higienização → produto químico adequado (desengordurante, desincrustante alcalino/ácido conforme sujidade), esponjas/escovas, pano técnico. GORDURA NÃO SAI SÓ COM ÁGUA.
Resistência elétrica → terminais, conectores, pasta térmica, parafusos, multímetro (verificar)
Motor/bomba → selo mecânico, parafusos, gaxetas, capacitor (se aplicável), rolamentos
Kit manômetro → niples, veda-rosca, conexões, registros
Válvula solenóide → conectores elétricos, vedações, abraçadeiras
Mangueira → abraçadeiras, conexões, adaptadores, veda-rosca
Pressostato → niples, mangueira de conexão, veda-rosca
Placa eletrônica → conectores, fusíveis, limpeza técnica (álcool isopropílico)
Componente roscado → veda-rosca, fita veda-rosca, niples, adaptadores
Qualquer serviço em equipamento de refrigeração → verificar carga de gás, teste de vazamento, manifold

POLÍTICAS WEDO (aplicar SOMENTE quando o gatilho for relevante para o equipamento em questão — NÃO aplique genericamente):
P1) Sujeira/insetos VISÍVEIS nas fotos ou relatados → dedetização + higienização
P2) Placa eletrônica mencionada ou visível → limpeza técnica (álcool isopropílico)
P3) Equipamento Rational com troca de componente → filtros ar/água
P4) Componente com fixação mecânica sendo trocado → fixadores, travas, porcas, arruelas DAQUELE componente
P5) Peça de desgaste sendo trocada → verificar APENAS peças de desgaste DO MESMO SUBSISTEMA (ex: se troca rolamento, verificar retentor e eixo — NÃO listar mangueiras/filtros se o equipamento não os possui)
P6) Calcário/sujidade mineral EVIDENCIADA → filtro de água, descalcificação
P7) Uso inadequado relatado → treinamento operacional

REGRA CRÍTICA SOBRE POLÍTICAS: Antes de aplicar qualquer política, PERGUNTE-SE: "Este equipamento específico TEM esse componente?" Se um passthrough/forno não tem mangueira, NÃO sugira mangueira. Se não tem filtro, NÃO sugira filtro. Aplique apenas o que FAZ SENTIDO para aquele equipamento.

FORMATO DE SAÍDA (máximo de objetividade):

📋 EQUIPAMENTO
Equipamento: [nome/modelo]
ID/Série: [valor ou NÃO IDENTIFICADO]

🔍 DIAGNÓSTICO
Defeito: [1-2 frases]
Coerência do técnico: [sim/não/parcial + motivo em 1 frase]
Inconsistências: [lista curta ou "nenhuma"]

⚠️ BLOQUEIOS
[SIM/NÃO] — [motivo ou "nenhum"]
Pendências: [lista objetiva]

🔧 PEÇAS, INSUMOS E QUÍMICOS
Para CADA item, formato em linha:
[Status] | [Item] | [Tipo] | [Motivo curto]

Status: ✅ Confirmado | ⚡ Recomendar | ❓ Verificar

IMPORTANTE: Liste TUDO que precisa para executar o serviço completo:
- Peças solicitadas pelo técnico
- COMPONENTES ADJACENTES que devem ser verificados/substituídos (motor, correia, rolamentos, selo, etc.)
- Insumos de montagem (veda-rosca, abraçadeiras, conexões...)
- Produtos químicos para limpeza/higienização
- Consumíveis (solda, gás, óleo, nitrogênio...)
- Peças de desgaste natural do equipamento
NÃO incluir EPIs básicos (luvas, óculos, capacete, sapato). Só EPIs específicos (PFF2, protetor auricular, avental químico).

🏭 POLÍTICAS WEDO
[Listar só as aplicáveis, 1 linha cada]

📝 OBSERVAÇÃO TÉCNICA (reescrita)
[Texto melhorado, máximo 5 linhas]

❓ PERGUNTAS (máx 5)
[Só as que realmente travam o orçamento]

🚦 STATUS: [Pode seguir / Ressalvas / Precisa validar] — [1 frase]

TOM: Telegráfico, técnico, zero enrolação.`;

      const userContentParts: any[] = [];

      // *** PERPLEXITY WEB SEARCH — pesquisa na internet ANTES da análise ***
      const webResearch = await searchEquipmentOnWeb(
        context?.equipamento || context?.descricao || "",
        context?.descricao || "",
        context?.orientacao || "",
        context?.pecas || ""
      );

      let textPrompt = `Analise a OS abaixo para apoio à elaboração de orçamento técnico.\n\nDADOS DA OS\n`;
      if (context) {
        textPrompt += `- Cliente: ${context.cliente || "N/A"}\n`;
        textPrompt += `- Técnico: ${context.tecnico || "N/A"}\n`;
        textPrompt += `- Data: ${context.data_tarefa || "N/A"}\n`;
        textPrompt += `- Equipamento: ${context.equipamento || context.descricao || "N/A"}\n`;
        textPrompt += `- ID / Patrimônio / Nº de Série do Equipamento: ${context.equipamento_id || "N/A"}\n`;
        textPrompt += `- Descrição do equipamento/chamado: ${context.descricao || "N/A"}\n`;
        textPrompt += `- Orientação inicial / descrição do chamado: ${context.orientacao || "N/A"}\n`;
        textPrompt += `- Peças informadas: ${context.pecas || "N/A"}\n`;
        textPrompt += `- Serviços informados: ${context.servicos || "N/A"}\n`;
        textPrompt += `- Tempo informado: ${context.tempo || "N/A"}\n`;
        textPrompt += `- Observações do técnico: ${context.observacoes || "N/A"}\n`;
        if (context.riscos) textPrompt += `- Riscos informados: ${context.riscos}\n`;
        if (context.todas_respostas) textPrompt += `- Respostas do questionário:\n${context.todas_respostas}\n`;
      }

      // Inject web research if available
      if (webResearch) {
        textPrompt += `\n🌐 ${webResearch}\n`;
        textPrompt += `\nIMPORTANTE: Use as informações da pesquisa web acima para ENRIQUECER sua análise. Compare o que o técnico informou com o que a internet diz sobre este equipamento. Identifique peças e componentes que o técnico pode ter esquecido baseado nas specs reais do equipamento.\n`;
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

      // Build context message with photos support
      const userContentParts: any[] = [];
      let contextText = `CONTEXTO DO ORÇAMENTO ATUAL\n\nOS:\n`;
      if (context) {
        contextText += `- Cliente: ${context.cliente || "N/A"}\n`;
        contextText += `- Técnico: ${context.tecnico || "N/A"}\n`;
        contextText += `- Data: ${context.data_tarefa || "N/A"}\n`;
        contextText += `- Equipamento: ${context.equipamento || "N/A"}\n`;
        contextText += `- ID / Série: ${context.equipamento_id || "N/A"}\n`;
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

      // Add photos if available (vision support for chat)
      const hasFotos = context?.fotos?.length > 0;
      if (hasFotos) {
        contextText += `\n\nFOTOS DA OS: ${filterImageUrls(context.fotos).length} foto(s) anexadas. Use-as para responder com mais precisão.`;
      }

      messages.push({ role: "system", content: systemPrompt });

      // Add chat history if present
      if (chatHistory && Array.isArray(chatHistory)) {
        for (const msg of chatHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      // Build multimodal user message with photos
      userContentParts.push({ type: "text", text: contextText });
      if (hasFotos) {
        await addPhotosToContent(userContentParts, context.fotos, 6, "low");
      }
      messages.push({ role: "user", content: userContentParts });

      console.log(`[genspark-ai] [chat] cliente=${context?.cliente}, hasAnalysis=${!!analysis}, fotos=${context?.fotos?.length || 0}, msgLength=${userMessage?.length}`);

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
