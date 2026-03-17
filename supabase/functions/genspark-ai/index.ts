import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

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
// GOOGLE DRIVE — busca documentos técnicos da pasta pública da WeDo
// =========================================================================
const DRIVE_FOLDER_ID = "1Sum9oUAzqfDew0FH1UC7_cIQyxEvAdcd";

async function fetchDriveDocuments(equipamentoFilter?: string): Promise<string> {
  const API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY");
  if (!API_KEY) {
    console.log("[genspark-ai] GOOGLE_DRIVE_API_KEY não disponível, pulando Drive");
    return "";
  }

  const results: string[] = [];
  let totalFilesRead = 0;
  let totalChars = 0;
  const MAX_FILES = 8;
  const MAX_TOTAL_CHARS = 15000;
  const DRIVE_TIMEOUT = 12000; // 12s max for entire Drive operation

  const extractPdfText = (bytes: Uint8Array): string => {
    try {
      const raw = new TextDecoder("latin1").decode(bytes);
      const textParts: string[] = [];
      const btEtRegex = /BT\s([\s\S]*?)ET/g;
      let m;
      while ((m = btEtRegex.exec(raw)) !== null) {
        const block = m[1];
        const tjRegex = /\(([^)]*)\)\s*Tj|\[(.*?)\]\s*TJ/g;
        let tj;
        while ((tj = tjRegex.exec(block)) !== null) {
          const content = tj[1] || (tj[2] || "").replace(/\([^)]*\)/g, (s) => s.slice(1, -1)).replace(/-?\d+\.?\d*/g, " ");
          if (content.trim()) textParts.push(content.trim());
        }
      }
      return textParts.join(" ").replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  };

  const isTextFile = (name: string) =>
    /\.(txt|csv|md|json|xml|html|htm|log|ini|cfg|yaml|yml|tsv)$/i.test(name);

  const addResult = (name: string, text: string, icon = "📄") => {
    if (text.length > 2500) text = text.substring(0, 2500) + "\n... [truncado]";
    results.push(`${icon} ${name}:\n${text}`);
    totalChars += text.length;
    totalFilesRead++;
    console.log(`[genspark-ai] Drive loaded: ${name} (${text.length} chars)`);
  };

  const limitReached = () => totalFilesRead >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS;

  async function listFolder(folderId: string): Promise<any[]> {
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${API_KEY}&fields=files(id,name,mimeType,size)&pageSize=100`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.files || [];
  }

  // Process only lightweight files (skip ZIPs entirely — too slow)
  async function processFile(file: any, parentPath: string) {
    if (limitReached()) return;
    const fileName = file.name || "";
    const mimeType = file.mimeType || "";
    const fullPath = parentPath ? `${parentPath}/${fileName}` : fileName;
    const fileSize = parseInt(file.size || "0", 10);

    // SKIP large files and ZIPs to keep it fast
    if (fileSize > 3 * 1024 * 1024) {
      results.push(`📎 ${fullPath} — arquivo grande (${Math.round(fileSize / 1024 / 1024)}MB), listado como referência`);
      return;
    }

    if (mimeType === "application/vnd.google-apps.document") {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain&key=${API_KEY}`);
        if (resp.ok) addResult(fullPath, await resp.text());
        else await resp.text(); // consume
      } catch (e) { console.error(`[genspark-ai] Doc error ${fullPath}:`, e); }
    }
    else if (mimeType === "application/vnd.google-apps.spreadsheet") {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv&key=${API_KEY}`);
        if (resp.ok) addResult(fullPath, await resp.text(), "📊");
        else await resp.text();
      } catch (e) { console.error(`[genspark-ai] Sheet error ${fullPath}:`, e); }
    }
    else if (mimeType.startsWith("text/") || isTextFile(fileName)) {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`);
        if (resp.ok) addResult(fullPath, await resp.text());
        else await resp.text();
      } catch (e) { console.error(`[genspark-ai] Text error ${fullPath}:`, e); }
    }
    else if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`);
        if (resp.ok) {
          const buf = new Uint8Array(await resp.arrayBuffer());
          const pdfText = extractPdfText(buf);
          if (pdfText.length > 50) addResult(fullPath, pdfText, "📕");
          else results.push(`📕 ${fullPath} — PDF (scan/imagem)`);
        } else await resp.text();
      } catch (e) { console.error(`[genspark-ai] PDF error ${fullPath}:`, e); }
    }
    else {
      results.push(`📎 ${fullPath} (${mimeType})`);
    }
  }

  try {
    // Wrap entire Drive operation in a timeout
    const drivePromise = (async () => {
      console.log(`[genspark-ai] Drive: listando pasta raiz...`);
      const topItems = await listFolder(DRIVE_FOLDER_ID);

      const folders = topItems.filter((f: any) => f.mimeType === "application/vnd.google-apps.folder");
      const topFiles = topItems.filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder");

      const filterTerms = (equipamentoFilter || "")
        .toLowerCase()
        .split(/[\s\-_,./]+/)
        .filter((t: string) => t.length > 2);

      console.log(`[genspark-ai] Drive: ${folders.length} pastas, ${topFiles.length} soltos, filtro=[${filterTerms.join(",")}]`);

      // Score folders by relevance
      const scoredFolders = folders.map((f: any) => {
        const nameLower = (f.name || "").toLowerCase();
        let score = 0;
        for (const term of filterTerms) {
          if (nameLower.includes(term)) score += 2;
        }
        return { ...f, score };
      }).sort((a: any, b: any) => b.score - a.score);

      // ONLY scan folders that match the equipment (score > 0)
      // If none match, scan just the top 2 folders (lightweight scan)
      const matchingFolders = scoredFolders.filter((f: any) => f.score > 0);
      const foldersToScan = matchingFolders.length > 0
        ? matchingFolders.slice(0, 3)
        : scoredFolders.slice(0, 2);

      // Process top-level text files only (skip ZIPs at root)
      for (const file of topFiles) {
        if (limitReached()) break;
        const mime = file.mimeType || "";
        const name = (file.name || "").toLowerCase();
        // Skip ZIPs at root level — too slow
        if (mime === "application/zip" || name.endsWith(".zip")) {
          // Only mention if it matches the filter
          if (filterTerms.some((t: string) => name.includes(t))) {
            results.push(`📦 ${file.name} — ZIP disponível (não processado por performance)`);
          }
          continue;
        }
        await processFile(file, "");
      }

      // Scan matched subfolders
      for (const folder of foldersToScan) {
        if (limitReached()) break;
        console.log(`[genspark-ai] Entrando: ${folder.name} (score=${folder.score})`);
        const subFiles = await listFolder(folder.id);

        // Prioritize files matching equipment, skip ZIPs
        const scoredFiles = subFiles
          .filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder")
          .map((f: any) => {
            const nameLower = (f.name || "").toLowerCase();
            const isZip = f.mimeType === "application/zip" || nameLower.endsWith(".zip");
            let score = isZip ? -10 : 0; // Penalize ZIPs heavily
            for (const term of filterTerms) {
              if (nameLower.includes(term)) score += 3;
            }
            return { ...f, score };
          })
          .sort((a: any, b: any) => b.score - a.score);

        for (const file of scoredFiles) {
          if (limitReached()) break;
          // Skip ZIPs inside subfolders too
          const name = (file.name || "").toLowerCase();
          if (file.mimeType === "application/zip" || name.endsWith(".zip")) continue;
          await processFile(file, folder.name);
        }
      }

      console.log(`[genspark-ai] Drive total: ${totalFilesRead} arquivos, ${totalChars} chars`);
    })();

    // Race with timeout
    await Promise.race([
      drivePromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Drive timeout")), DRIVE_TIMEOUT)),
    ]);

    if (results.length === 0) return "";
    return `MATERIAIS INTERNOS (Google Drive WeDo):\n${results.join("\n\n")}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[genspark-ai] Drive: ${msg} (${totalFilesRead} arquivos lidos até aqui)`);
    if (results.length > 0) {
      return `MATERIAIS INTERNOS (Google Drive WeDo) [parcial]:\n${results.join("\n\n")}`;
    }
    return "";
  }
}
        await processFile(file, folder.name);
      }
    }

    console.log(`[genspark-ai] Drive total: ${totalFilesRead} arquivos lidos, ${totalChars} chars`);
    if (results.length === 0) return "";
    return `MATERIAIS INTERNOS (Google Drive WeDo):\n${results.join("\n\n")}`;
  } catch (e) {
    console.error("[genspark-ai] Drive fetch error:", e);
    return "";
  }
}

// =========================================================================
// PERPLEXITY WEB SEARCH — pesquisa técnica na internet sobre o equipamento
// =========================================================================
async function searchPerplexity(
  query: string,
  systemInstruction: string,
  options?: { domains?: string[]; recency?: string }
): Promise<{ answer: string; citations: string[] }> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    console.log("[genspark-ai] PERPLEXITY_API_KEY não disponível, pulando pesquisa web");
    return { answer: "", citations: [] };
  }

  if (!query.trim()) {
    console.log("[genspark-ai] Query vazia, pulando pesquisa web");
    return { answer: "", citations: [] };
  }

  try {
    console.log(`[genspark-ai] Pesquisando Perplexity: "${query.substring(0, 100)}..."`);

    const bodyPayload: any = {
      model: "sonar-pro",
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: query }
      ],
      temperature: 0.1,
    };

    // Filtro de domínios se fornecido
    if (options?.domains && options.domains.length > 0) {
      bodyPayload.search_domain_filter = options.domains;
    }

    // Filtro de recência
    if (options?.recency) {
      bodyPayload.search_recency_filter = options.recency;
    }

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[genspark-ai] Perplexity error ${response.status}: ${errText.substring(0, 200)}`);
      return { answer: "", citations: [] };
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "";
    const citations = data.citations || [];

    console.log(`[genspark-ai] Perplexity respondeu: ${answer.length} chars, ${citations.length} fontes`);
    return { answer, citations };
  } catch (e) {
    console.error("[genspark-ai] Perplexity search failed:", e);
    return { answer: "", citations: [] };
  }
}

async function searchEquipmentOnWeb(equipamento: string, descricao: string, orientacao: string, pecas: string): Promise<string> {
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

  const { answer, citations } = await searchPerplexity(
    searchQuery,
    "Você é um engenheiro de manutenção industrial. Responda em português brasileiro de forma técnica e objetiva. Foque em dados concretos: especificações, peças, componentes, problemas comuns. Sem floreios."
  );

  if (!answer) return "";

  let result = `PESQUISA WEB (fontes reais da internet):\n${answer}`;
  if (citations.length > 0) {
    result += `\n\nFONTES: ${citations.slice(0, 5).join(", ")}`;
  }
  return result;
}

// Pesquisa contextual para o chat — busca na web baseada na dúvida do usuário
async function searchForChatQuestion(
  userMessage: string,
  equipamento: string,
  orientacao: string,
  analysis: string
): Promise<string> {
  const equipClean = (equipamento || "").replace(/n\/a/gi, "").trim();

  const searchQuery = `Contexto: equipamento "${equipClean || "industrial"}".
${orientacao ? `Problema: ${orientacao}` : ""}

Dúvida técnica: ${userMessage}

Responda com dados técnicos reais: especificações, manuais, experiência documentada, normas técnicas.`;

  const { answer, citations } = await searchPerplexity(
    searchQuery,
    "Você é um engenheiro de manutenção industrial sênior. Pesquise na web e responda com dados técnicos concretos, citando fontes. Foque em: especificações de fabricante, manuais técnicos, normas, problemas documentados. Responda em português brasileiro. Seja preciso e direto."
  );

  if (!answer) return "";

  let result = `\n\n========== 🌐 PESQUISA WEB (PERPLEXITY) ==========\n${answer}`;
  if (citations.length > 0) {
    result += `\n\nFontes consultadas:\n${citations.slice(0, 8).map((c: string, i: number) => `[${i + 1}] ${c}`).join("\n")}`;
  }
  result += `\n==========================================================`;
  return result;
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

🌐 PESQUISA WEB (OBRIGATÓRIO se dados de pesquisa web foram fornecidos)
Se recebeu dados de PESQUISA WEB, OBRIGATORIAMENTE inclua esta seção:
- Modelo identificado: [modelo exato encontrado na web]
- Especificações relevantes: [specs que impactam o diagnóstico, 2-3 linhas]
- Componentes típicos deste equipamento: [lista dos componentes principais conforme manual/web]
- Problemas comuns documentados: [1-3 problemas mais frequentes encontrados na web]
- Fontes: [citar fontes se disponíveis]
Se NÃO recebeu dados de pesquisa web, escreva: "Pesquisa web não disponível para este equipamento."

🔍 DIAGNÓSTICO
Defeito: [1-2 frases]
Coerência do técnico: [sim/não/parcial + motivo em 1 frase]
Inconsistências: [lista curta ou "nenhuma"]
Dados da web vs técnico: [O que a pesquisa web revelou que o técnico NÃO mencionou — peças faltantes, verificações omitidas, etc. Se não houver pesquisa web, omitir esta linha]

⚠️ BLOQUEIOS
[SIM/NÃO] — [motivo ou "nenhum"]
Pendências: [lista objetiva]

🔧 PEÇAS, INSUMOS E QUÍMICOS
Para CADA item, formato em linha:
[Status] | [Item] | [Tipo] | [Motivo curto]

Status: ✅ Confirmado | ⚡ Recomendar | ❓ Verificar
🌐 = Item identificado via pesquisa web (USE ESTE ÍCONE para itens que vieram da pesquisa web)

IMPORTANTE: Liste TUDO que precisa para executar o serviço completo:
- Peças solicitadas pelo técnico
- 🌐 Peças e componentes identificados pela PESQUISA WEB que o técnico não mencionou
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

      // *** PARALLEL: Perplexity web search + Google Drive docs ***
      const equipForSearch = context?.equipamento || context?.descricao || "";
      const [webResearch, driveContext] = await Promise.all([
        searchEquipmentOnWeb(
          equipForSearch,
          context?.descricao || "",
          context?.orientacao || "",
          context?.pecas || ""
        ),
        fetchDriveDocuments(equipForSearch),
      ]);

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
        textPrompt += `\n\n========== 🌐 DADOS DA PESQUISA WEB (PERPLEXITY) ==========\n${webResearch}\n==========================================================\n`;
        textPrompt += `\nINSTRUÇÃO OBRIGATÓRIA: Você RECEBEU dados de pesquisa web acima. Você DEVE:
1. Preencher a seção "🌐 PESQUISA WEB" com os dados encontrados
2. Na seção DIAGNÓSTICO, incluir "Dados da web vs técnico" comparando o que a web diz vs o que o técnico informou
3. Na seção PEÇAS, marcar com 🌐 os itens que vieram da pesquisa web e que o técnico NÃO mencionou
4. Se a web revelou componentes específicos deste modelo que o técnico omitiu, LISTE-OS como ⚡🌐 Recomendar\n`;
      }

      const hasFotos = context?.fotos?.length > 0;
      textPrompt += `\nFOTOS\n${hasFotos ? `${filterImageUrls(context.fotos).length} foto(s) anexadas. ANALISE CADA FOTO.` : "Não fornecidas"}\n`;
      
      // Inject Drive documents if available
      if (driveContext) {
        textPrompt += `\n\n========== 📂 ${driveContext} ==========\n`;
        textPrompt += `\nINSTRUÇÃO: Use os materiais internos acima para fundamentar o diagnóstico. Se houver manuais, tabelas de peças ou procedimentos relevantes, cite-os na análise. Marque com 📂 informações vindas dos materiais internos.\n`;
      } else {
        textPrompt += `\nMATERIAIS INTERNOS\nNão fornecidos\n`;
      }
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
- Base (indicar se veio de: evidência visual, evidência textual, política WeDo, pesquisa web 🌐, manual/POP)
- Risco de seguir sem validar
- Próximo passo

Se houver dados de PESQUISA WEB no contexto:
- Use-os para fundamentar sua resposta com dados reais
- Cite as fontes relevantes com [fonte]
- Se a web contradizer a análise, explique a divergência
- Marque informações vindas da web com 🌐

TOM
Técnico, direto, sem floreio. Potente e fundamentado.`;

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

      // *** PARALLEL: Perplexity web search + Google Drive docs ***
      const [chatWebResearch, chatDriveContext] = await Promise.all([
        searchForChatQuestion(
          userMessage,
          context?.equipamento || context?.descricao || "",
          context?.orientacao || "",
          analysis || ""
        ),
        fetchDriveDocuments(context?.equipamento || context?.descricao || ""),
      ]);

      if (chatWebResearch) {
        contextText += chatWebResearch;
        contextText += `\n\nINSTRUÇÃO: Você RECEBEU dados de pesquisa web acima. Use-os para fundamentar sua resposta com dados reais. Cite as fontes quando relevante. Se a pesquisa web contradizer algo, explique a divergência.`;
      }

      if (chatDriveContext) {
        contextText += `\n\n========== 📂 ${chatDriveContext} ==========\n`;
        contextText += `\nINSTRUÇÃO: Use os materiais internos da WeDo acima para fundamentar sua resposta. Marque com 📂 informações vindas dos materiais internos.`;
      } else {
        contextText += `\n\nMATERIAIS INTERNOS:\nNão fornecidos\n`;
      }
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

      console.log(`[genspark-ai] [chat] cliente=${context?.cliente}, hasAnalysis=${!!analysis}, fotos=${context?.fotos?.length || 0}, webResearch=${!!chatWebResearch}, msgLength=${userMessage?.length}`);

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
