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
// INTERNAL TECH DOCS — busca documentos técnicos da pasta pública WeDo
// =========================================================================
const DRIVE_FOLDER_ID = "1Sum9oUAzqfDew0FH1UC7_cIQyxEvAdcd";
const INTERNAL_DOCS_TIMEOUT = 25000; // 25s — balancear cobertura vs CPU limit
const MAX_DOCS = 6;
const MAX_TOTAL_CHARS = 30000;

type InternalDocsResult = {
  text: string;
  docs_count: number;
  docs_titles: string[];
  skipped_files: string[];
  elapsed_ms: number;
  error: string | null;
  api_source: string;
  manufacturer_identified: string | null;
};

// =========================================================================
// IDENTIFY MANUFACTURER — quick Perplexity call to find the real manufacturer
// =========================================================================
async function identifyManufacturer(equipamento: string): Promise<string[]> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY || !equipamento.trim()) return [];

  try {
    console.log(`[genspark-ai] [manufacturer] Identificando fabricante de: "${equipamento.substring(0, 80)}"`);
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "Responda APENAS com o nome da marca/fabricante. Somente letras, sem números, sem modelo, sem explicação. Exemplo: se o equipamento é 'Ecomax 503', responda 'Hobart'. Se não souber, responda 'desconhecido'." },
          { role: "user", content: `Qual é a marca/fabricante deste equipamento de cozinha industrial? "${equipamento}". Responda SOMENTE o nome da marca (ex: Hobart, Rational, Vulcan, Prática, Tramontina).` }
        ],
        temperature: 0.0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[genspark-ai] [manufacturer] Perplexity HTTP ${response.status}: ${errText.substring(0, 100)}`);
      return [];
    }

    const data = await response.json();
    const answer = (data.choices?.[0]?.message?.content || "").trim();
    console.log(`[genspark-ai] [manufacturer] Resultado: "${answer}"`);

    if (!answer || answer.toLowerCase() === "desconhecido") return [];

    // Extract manufacturer terms — STRIP ALL NUMBERS (avoid "hobart123456" pollution)
    const cleanAnswer = answer
      .split("\n")[0]
      .replace(/[0-9]/g, "")              // remove all digits
      .replace(/[^a-zA-ZÀ-ÿ\s\-]/g, "")  // keep only letters
      .trim();

    const terms = cleanAnswer
      .toLowerCase()
      .split(/[\s\-_]+/)
      .filter((t: string) => t.length > 2);

    // Also add common variations (e.g., "hobart" should also match "hobart - vulcan" folder)
    const expandedTerms = [...terms];
    // Known brand aliases/groups in our Drive
    const brandAliases: Record<string, string[]> = {
      "hobart": ["hobart", "vulcan"],
      "rational": ["rational"],
      "pratica": ["pratica", "prática"],
      "tramontina": ["tramontina"],
      "elgin": ["elgin"],
    };
    for (const term of terms) {
      const aliases = brandAliases[term];
      if (aliases) {
        for (const alias of aliases) {
          if (!expandedTerms.includes(alias)) expandedTerms.push(alias);
        }
      }
    }

    console.log(`[genspark-ai] [manufacturer] Termos extraídos: [${expandedTerms.join(",")}]`);
    return expandedTerms;
  } catch (e) {
    console.warn(`[genspark-ai] [manufacturer] Erro: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

async function fetchInternalTechDocs(query?: string, equipamento?: string): Promise<InternalDocsResult> {
  const startTime = Date.now();
  const result: InternalDocsResult = {
    text: "",
    docs_count: 0,
    docs_titles: [],
    skipped_files: [],
    elapsed_ms: 0,
    error: null,
    api_source: "google_drive_api",
    manufacturer_identified: null,
  };

  const API_KEY = Deno.env.get("GOOGLE_DRIVE_API_KEY");
  if (!API_KEY) {
    result.error = "GOOGLE_DRIVE_API_KEY não configurada no ambiente";
    result.elapsed_ms = Date.now() - startTime;
    console.error(`[genspark-ai] [internal-docs] ${result.error}`);
    return result;
  }

  // Step 1: Identify manufacturer via Perplexity (quick web search)
  const equipStr = (equipamento || query || "").trim();
  const manufacturerTerms = await identifyManufacturer(equipStr);
  result.manufacturer_identified = manufacturerTerms.length > 0 ? manufacturerTerms.join(" ") : null;

  // Build filter terms: manufacturer terms FIRST (higher priority), then equipment terms
  // Strip common equipment function words that pollute search (lava louças, forno, fogão, etc.)
  const functionWords = [
    "lava", "louça", "louças", "lavalouças", "forno", "fogão", "fogao",
    "geladeira", "freezer", "refrigerador", "máquina", "maquina",
    "equipamento", "industrial", "comercial", "profissional",
    "elétrico", "eletrico", "elétrica", "eletrica", "gas", "gás",
    "mesa", "balcão", "balcao", "bancada", "piso", "parede",
    "processador", "cortador", "moedor", "misturador", "batedeira",
    "chapa", "grill", "coifa", "exaustor", "pass", "through",
  ];

  const equipTerms = equipStr
    .toLowerCase()
    .split(/[\s\-_,./]+/)
    .filter((t: string) => t.length > 2)
    .filter((t: string) => !functionWords.includes(t));

  // Combine manufacturer + equipment terms, dedup
  const allTermsSet = new Set([...manufacturerTerms, ...equipTerms]);
  const filterTerms = Array.from(allTermsSet);

  console.log(`[genspark-ai] [internal-docs] Termos de busca (sem palavras genéricas): [${filterTerms.join(",")}]`);

  console.log(`[genspark-ai] [internal-docs] Iniciando busca. equipamento="${equipStr.substring(0, 80)}", fabricante="${result.manufacturer_identified || "não identificado"}", filtros=[${filterTerms.join(",")}]`);

  const results: string[] = [];
  let totalFilesRead = 0;
  let totalChars = 0;

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

  // ---- OCR via Google Cloud Vision API (para PDFs escaneados) ----
  const ocrPdfViaVision = async (pdfBytes: Uint8Array, fileName: string): Promise<string> => {
    try {
      // Convert bytes to base64
      let binary = "";
      for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
      const base64Content = btoa(binary);

      console.log(`[genspark-ai] [OCR] Enviando PDF para Vision API: ${fileName} (${Math.round(pdfBytes.length / 1024)}KB)`);

      const visionUrl = `https://vision.googleapis.com/v1/files:annotate?key=${API_KEY}`;
      const visionResp = await fetch(visionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            inputConfig: {
              content: base64Content,
              mimeType: "application/pdf",
            },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            pages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], // primeiras 20 páginas
          }],
        }),
      });

      if (!visionResp.ok) {
        const errBody = await visionResp.text();
        console.error(`[genspark-ai] [OCR] Vision API HTTP ${visionResp.status}: ${errBody.substring(0, 300)}`);
        return "";
      }

      const visionData = await visionResp.json();
      const responses = visionData.responses || [];
      const textParts: string[] = [];

      for (const resp of responses) {
        const pages = resp.responses || [];
        for (const page of pages) {
          const fullText = page.fullTextAnnotation?.text;
          if (fullText) textParts.push(fullText);
        }
      }

      const ocrText = textParts.join("\n\n").trim();
      console.log(`[genspark-ai] [OCR] Vision API retornou ${ocrText.length} chars para ${fileName}`);
      return ocrText;
    } catch (e) {
      console.error(`[genspark-ai] [OCR] Erro Vision API para ${fileName}:`, e instanceof Error ? e.message : String(e));
      return "";
    }
  };

  const isTextFile = (name: string) =>
    /\.(txt|csv|md|json|xml|html|htm|log|ini|cfg|yaml|yml|tsv)$/i.test(name);

  const limitReached = () => totalFilesRead >= MAX_DOCS || totalChars >= MAX_TOTAL_CHARS;

  const addResult = (name: string, text: string, icon = "📄") => {
    if (text.length > 8000) text = text.substring(0, 8000) + "\n... [truncado]";
    results.push(`${icon} ${name}:\n${text}`);
    totalChars += text.length;
    totalFilesRead++;
    result.docs_titles.push(name);
    console.log(`[genspark-ai] [internal-docs] Loaded: ${name} (${text.length} chars)`);
  };

  async function listFolder(folderId: string): Promise<any[]> {
    const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${API_KEY}&fields=files(id,name,mimeType,size)&pageSize=100`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(`[genspark-ai] [internal-docs] Drive list FAILED: HTTP ${resp.status} — ${errBody.substring(0, 200)}`);
      throw new Error(`Drive API HTTP ${resp.status}: ${errBody.substring(0, 100)}`);
    }
    const data = await resp.json();
    return data.files || [];
  }

  async function processFile(file: any, parentPath: string) {
    if (limitReached()) return;
    const fileName = file.name || "";
    const mimeType = file.mimeType || "";
    const fullPath = parentPath ? `${parentPath}/${fileName}` : fileName;
    const fileSize = parseInt(file.size || "0", 10);

    console.log(`[genspark-ai] [internal-docs] processFile: ${fullPath} (mime=${mimeType}, size=${fileSize})`);

    if (fileSize > 5 * 1024 * 1024) {
      result.skipped_files.push(`${fullPath} (${Math.round(fileSize / 1024 / 1024)}MB — muito grande)`);
      results.push(`📎 ${fullPath} — arquivo grande (${Math.round(fileSize / 1024 / 1024)}MB), listado como referência`);
      return;
    }

    if (mimeType === "application/vnd.google-apps.document") {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain&key=${API_KEY}`);
        if (resp.ok) addResult(fullPath, await resp.text());
        else { const e = await resp.text(); console.warn(`[genspark-ai] [internal-docs] Doc export FAILED ${fullPath}: HTTP ${resp.status} — ${e.substring(0, 200)}`); }
      } catch (e) { console.error(`[genspark-ai] [internal-docs] Doc error ${fullPath}:`, e); }
    }
    else if (mimeType === "application/vnd.google-apps.spreadsheet") {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv&key=${API_KEY}`);
        if (resp.ok) addResult(fullPath, await resp.text(), "📊");
        else await resp.text();
      } catch (e) { console.error(`[genspark-ai] [internal-docs] Sheet error ${fullPath}:`, e); }
    }
    else if (mimeType.startsWith("text/") || isTextFile(fileName)) {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`);
        if (resp.ok) addResult(fullPath, await resp.text());
        else await resp.text();
      } catch (e) { console.error(`[genspark-ai] [internal-docs] Text error ${fullPath}:`, e); }
    }
    else if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${API_KEY}`);
        if (resp.ok) {
          const buf = new Uint8Array(await resp.arrayBuffer());
          const pdfText = extractPdfText(buf);
          if (pdfText.length > 50) {
            addResult(fullPath, pdfText, "📕");
          } else {
            // PDF escaneado — tentar OCR via Google Cloud Vision API
            console.log(`[genspark-ai] [internal-docs] PDF sem texto extraível, tentando OCR: ${fullPath}`);
            const ocrText = await ocrPdfViaVision(buf, fullPath);
            if (ocrText.length > 50) {
              addResult(fullPath, ocrText, "🔍");
              console.log(`[genspark-ai] [OCR] Sucesso! ${ocrText.length} chars extraídos de ${fullPath}`);
            } else {
              result.skipped_files.push(`${fullPath} (PDF scan — OCR sem resultado útil)`);
              results.push(`📕 ${fullPath} — PDF escaneado (OCR não extraiu texto suficiente)`);
            }
          }
        } else await resp.text();
      } catch (e) { console.error(`[genspark-ai] [internal-docs] PDF error ${fullPath}:`, e); }
    }
    else {
      result.skipped_files.push(`${fullPath} (${mimeType})`);
      results.push(`📎 ${fullPath} (${mimeType})`);
    }
  }

  try {
    const drivePromise = (async () => {
      console.log(`[genspark-ai] [internal-docs] Listando pasta raiz ${DRIVE_FOLDER_ID}...`);
      const topItems = await listFolder(DRIVE_FOLDER_ID);

      const folders = topItems.filter((f: any) => f.mimeType === "application/vnd.google-apps.folder");
      const topFiles = topItems.filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder");

      console.log(`[genspark-ai] [internal-docs] ${folders.length} pastas, ${topFiles.length} arquivos na raiz`);

      // Score folders by relevance — manufacturer terms get EXTRA weight
      const scoredFolders = folders.map((f: any) => {
        const nameLower = (f.name || "").toLowerCase();
        let score = 0;
        for (const term of filterTerms) {
          if (nameLower.includes(term)) {
            // Manufacturer terms get 5 points, equipment terms get 2
            score += manufacturerTerms.includes(term) ? 5 : 2;
          }
        }
        return { ...f, score };
      }).sort((a: any, b: any) => b.score - a.score);

      const matchingFolders = scoredFolders.filter((f: any) => f.score > 0);
      // ONLY scan folders that actually matched — don't fallback to random folders (avoids scanning AUVO with 100+ PDFs)
      const foldersToScan = matchingFolders.slice(0, 3);

      if (foldersToScan.length === 0) {
        console.warn(`[genspark-ai] [internal-docs] NENHUMA pasta correspondeu aos termos [${filterTerms.join(",")}]. Pastas disponíveis: ${folders.map((f: any) => f.name).join(", ")}`);
      }

      // Process top-level files (skip ZIPs)
      for (const file of topFiles) {
        if (limitReached()) break;
        const mime = file.mimeType || "";
        const name = (file.name || "").toLowerCase();
        if (mime === "application/zip" || name.endsWith(".zip")) {
          if (filterTerms.some((t: string) => name.includes(t))) {
            results.push(`📦 ${file.name} — ZIP disponível (não processado por performance)`);
          }
          continue;
        }
        await processFile(file, "");
      }

      // List all matched subfolders IN PARALLEL for speed
      const folderListings = await Promise.all(
        foldersToScan.map(async (folder: any) => {
          console.log(`[genspark-ai] [internal-docs] Listando subpasta: ${folder.name} (score=${folder.score})`);
          const subFiles = await listFolder(folder.id);
          return { folder, subFiles };
        })
      );

      // Process files from all folders
      for (const { folder, subFiles } of folderListings) {
        if (limitReached()) break;
        console.log(`[genspark-ai] [internal-docs] Processando: ${folder.name} (${subFiles.length} arquivos)`);

        // Progressive file scoring: try full terms first, then progressively shorter model names
        // E.g. "ecomax 503" → try "ecomax 503", then "ecomax", then "503"
        const modelTerms = filterTerms.filter((t: string) => !manufacturerTerms.includes(t));
        
        const scoredFiles = subFiles
          .filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder")
          .map((f: any) => {
            const nameLower = (f.name || "").toLowerCase();
            const isZip = f.mimeType === "application/zip" || nameLower.endsWith(".zip");
            let score = isZip ? -10 : 0;
            
            // Check each term individually
            for (const term of filterTerms) {
              if (nameLower.includes(term)) {
                score += manufacturerTerms.includes(term) ? 2 : 5; // model terms worth MORE for file matching
              }
            }
            
            // Bonus: check combined model terms (e.g. "ecomax 503" as substring)
            if (modelTerms.length > 1) {
              const combined = modelTerms.join(" ");
              if (nameLower.includes(combined)) score += 10;
              // Also try without spaces (e.g. "ecomax503")
              const noSpace = modelTerms.join("");
              if (nameLower.includes(noSpace)) score += 8;
            }
            
            // Progressive: if full model didn't match, try partial (e.g. "scc" from "scc 201")
            if (score <= 0 && modelTerms.length > 0) {
              for (const term of modelTerms) {
                // Try first 3+ chars of each term
                if (term.length >= 3 && nameLower.includes(term.substring(0, 3))) {
                  score += 1;
                }
              }
            }
            
            return { ...f, score };
          })
          .sort((a: any, b: any) => b.score - a.score);

        for (const file of scoredFiles) {
          if (limitReached()) break;
          const name = (file.name || "").toLowerCase();
          if (file.mimeType === "application/zip" || name.endsWith(".zip")) continue;
          await processFile(file, folder.name);
        }
      }

      console.log(`[genspark-ai] [internal-docs] Busca concluída: ${totalFilesRead} docs, ${totalChars} chars`);
    })();

    await Promise.race([
      drivePromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Timeout: busca interna excedeu 15s")), INTERNAL_DOCS_TIMEOUT)),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[genspark-ai] [internal-docs] ERRO: ${msg} (${totalFilesRead} docs lidos até aqui)`);
    result.error = msg;
    // Keep partial results if any
  }

  result.docs_count = totalFilesRead;
  result.elapsed_ms = Date.now() - startTime;

  if (results.length > 0) {
    result.text = `MATERIAIS INTERNOS (API Banco Técnico WeDo):\n${results.join("\n\n")}`;
    if (totalChars >= MAX_TOTAL_CHARS) {
      result.text += "\n\n... [truncado — limite de caracteres atingido]";
    }
  }

  console.log(`[genspark-ai] [internal-docs] Resultado final: ${result.docs_count} docs, ${result.elapsed_ms}ms, error=${result.error || "nenhum"}`);
  return result;
}

// =========================================================================
// PERPLEXITY WEB SEARCH
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

    if (options?.domains && options.domains.length > 0) {
      bodyPayload.search_domain_filter = options.domains;
    }
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

// =========================================================================
// Helper: build internal docs block for prompt
// =========================================================================
function buildInternalDocsBlock(docsResult: InternalDocsResult): string {
  if (docsResult.docs_count > 0 && docsResult.text) {
    let block = `\n\n========== 📂 ${docsResult.text} ==========\n`;
    block += `\nINSTRUÇÃO: Use os materiais internos acima para fundamentar o diagnóstico. Marque com 📂 informações vindas dos materiais internos.\n`;
    if (docsResult.error) {
      block += `\n⚠️ Busca interna parcial (${docsResult.error}). ${docsResult.docs_count} doc(s) carregados em ${docsResult.elapsed_ms}ms.\n`;
    }
    return block;
  }

  // No docs found — explain why explicitly
  let reason = "Nenhum documento retornado";
  if (docsResult.error) {
    reason = `Erro na busca: ${docsResult.error}`;
  }
  return `\n\nMATERIAIS INTERNOS (API Banco Técnico WeDo):\n📂 Sem material interno retornado pela API (${reason}). Tempo: ${docsResult.elapsed_ms}ms.\n`;
}

function buildWebBlock(webResearch: string): string {
  if (!webResearch) {
    return `\n\nPESQUISA WEB:\n🌐 Pesquisa web não disponível.\n`;
  }
  return `\n\n========== 🌐 DADOS DA PESQUISA WEB (PERPLEXITY) ==========\n${webResearch}\n==========================================================\n`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action } = body;

    // =========================================================================
    // 0) DIAGNOSTIC MODE — test internal docs fetch
    // =========================================================================
    if (action === "internal_docs_test") {
      const { query, equipamento } = body;
      const searchQuery = query || equipamento || "Rational iCombi";
      console.log(`[genspark-ai] [internal_docs_test] query="${searchQuery}"`);
      const docsResult = await fetchInternalTechDocs(searchQuery, equipamento);
      return new Response(JSON.stringify({
        api_source: docsResult.api_source,
        manufacturer_identified: docsResult.manufacturer_identified,
        query: searchQuery,
        docs_count: docsResult.docs_count,
        docs_titles: docsResult.docs_titles.slice(0, 20),
        skipped_files: docsResult.skipped_files.slice(0, 20),
        elapsed_ms: docsResult.elapsed_ms,
        error: docsResult.error,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada");

    const messages: any[] = [];
    let model = "gpt-4o-mini";

    // =========================================================================
    // 1) MELHORAR PREENCHIMENTO
    // =========================================================================
    if (action === "improve") {
      const { text, field, context } = body;

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

      if (tipoCampo === "OBSERVAÇÕES" && context) {
        if (context.pecas) userText += `\n\nPeças solicitadas: ${context.pecas}`;
        if (context.orientacao) userText += `\nOrientação do serviço: ${context.orientacao}`;
      }

      userContentParts.push({ type: "text", text: userText });

      if (tipoCampo === "OBSERVAÇÕES" && context?.fotos?.length > 0) {
        await addPhotosToContent(userContentParts, context.fotos, 4, "low");
        model = "gpt-4o";
      }

      messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: userContentParts.length === 1 ? userText : userContentParts });

    // =========================================================================
    // 2) ANALISAR OS PARA ORÇAMENTO
    // =========================================================================
    } else if (action === "analyze") {
      const { context } = body;
      model = "gpt-4o";

      const systemPrompt = `Você é o engenheiro técnico sênior da WeDo. Analise OS para orçamento.

MISSÃO: Diagnóstico técnico preciso + lista COMPLETA de tudo que precisa para executar o serviço.

REGRA #0 — ANALISE O RELATÓRIO ANTES DE LISTAR ITENS. Primeiro extraia: defeitos confirmados, sintomas, peças citadas, serviço solicitado e contexto das fotos.
REGRA #1 — SEJA OBJETIVO. Frases curtas. Sem floreio. Sem repetição. Sem linguagem de IA.
REGRA #2 — COMPLEMENTE O RELATÓRIO COM LÓGICA TÉCNICA. Para cada defeito/intervenção do relatório, complete com os componentes, consumíveis e verificações NECESSÁRIOS do mesmo subsistema.
REGRA #3 — NÃO INVENTE DEFEITOS. Só trabalhe com dados/fotos/material fornecido. Pode recomendar verificações adjacentes quando fizer sentido técnico.
REGRA #4 — Separe FATO de INFERÊNCIA de HIPÓTESE.
REGRA #5 — Nunca fale de preço/valor/margem.
REGRA #6 — NÃO LISTE EPIs BÁSICOS. Luvas, óculos de proteção, capacete e sapato de segurança são fornecidos pela empresa e NÃO devem aparecer na lista. Só liste EPIs ESPECÍFICOS para aquele serviço (ex: máscara PFF2 para gás refrigerante, protetor auricular para martelete, avental químico para ácido).

REGRA #7 — COERÊNCIA DIAGNÓSTICO ↔ PEÇAS (CRÍTICO):
Se o diagnóstico diz "DANO" em um componente, a recomendação OBRIGATÓRIA é TROCA do componente danificado (não manutenção preventiva).
- "Dano nos rolamentos" → ⚡ Troca de rolamentos + itens adjacentes necessários do subsistema (ex.: retentor/eixo/mancal quando aplicável).
- "Motor superaquecendo" → ⚡ Verificar/trocar protetor térmico, capacitor, ventilador. Se há dano, é TROCA.
- "Placa danificada" → ⚡ Troca da placa. Não "limpeza técnica" como solução principal.
- "Sensor ausente" → ⚡ Troca do sensor. Não "verificar" como ação final.
- Se o relatório trouxer "conjunto suporte do motor e eixo", "mancal", "eixo com folga" ou "rolamento danificado", NÃO aceite só item genérico: explicite em linhas separadas os itens críticos do conjunto (ROLAMENTO e RETENTOR, além de eixo/mancal quando aplicável).
REGRA: Se o defeito é DANO/DANIFICADO/COMPROMETIDO/QUEIMADO/AUSENTE → a ação principal é TROCA/SUBSTITUIÇÃO.
Lubrificação só se aplica a componentes FUNCIONAIS em manutenção preventiva.

RACIOCÍNIO DE COMPONENTES ADJACENTES (OBRIGATÓRIO):
Quando identificar o equipamento, PENSE nos subsistemas:
- Máquina com MOTOR → verificar: correia, polias, rolamentos do motor, capacitor, protetor térmico, ventilador
- Máquina com BOMBA → verificar: selo mecânico, gaxetas, rolamentos, acoplamento, eixo, impulsor
- Máquina com COMPRESSOR → verificar: válvulas, pressostato, capacitor, relé, gás, óleo, filtro secador, ventilador do condensador
- Máquina com RESISTÊNCIA → verificar: terminais, conectores, termostato, fusível térmico, fiação
- GATILHO EIXO/MANCAL (abertura do conjunto) → incluir obrigatoriamente: rolamento(s) + retentor(es) + verificação de eixo/mancal; se houver dano, marcar TROCA.
- Máquina com ROLAMENTOS DANIFICADOS → TROCAR: rolamentos + retentor + verificar eixo (folga/desgaste) + mancal. Se funcionais: lubrificar + verificar correia
- Máquina com REDUTOR → verificar: engrenagens, rolamentos, óleo, retentores, acoplamento
- Máquina com CORREIA → verificar: polias (desgaste/alinhamento), tensor, rolamentos dos eixos
- Máquina com ELETROVÁLVULA → verificar: bobina, vedações, filtro de linha, conexões
- Equipamento de REFRIGERAÇÃO → verificar: carga de gás, teste de vazamento, limpeza do condensador, dreno, isolamento térmico
- CÂMARA FRIA ou CÂMARA CONGELADA → verificar OBRIGATORIAMENTE: gaxetas de vedação (borrachas das portas), relé de falta de fase, contatores, controlador de temperatura, disjuntores, estabilizador de tensão, resistência de degelo, timer de degelo, válvula de expansão, pressostato de alta/baixa, ventiladores do evaporador, ventiladores do condensador, isolamento térmico (portas e painéis), dreno do evaporador, termômetro/sensor de temperatura. PESQUISAR NA WEB itens de preventiva específicos do modelo/fabricante da câmara.

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
Câmara fria/congelada → gaxetas de vedação, relé falta de fase, contatores, controlador temperatura, disjuntores, estabilizador tensão, resistência degelo, timer degelo, válvula expansão, pressostato alta/baixa, ventiladores evaporador/condensador, sensor temperatura, isolamento térmico portas/painéis

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
Marca/Fabricante: [marca — OBRIGATÓRIO. Use o valor fornecido no campo "Marca/Fabricante identificada" dos DADOS DA OS. Se não foi identificada ou se está como "Não identificada", escreva: "⚠️ NÃO IDENTIFICADA — Favor informar a marca/fabricante do equipamento para melhor análise e busca de materiais técnicos."]

📂 MATERIAIS INTERNOS (se fornecidos)
Se recebeu materiais internos (📂), OBRIGATORIAMENTE inclua esta seção:
- Documentos encontrados: [nomes dos docs]
- Informações relevantes extraídas: [dados técnicos, procedimentos, peças recomendadas]
- Aplicação ao caso: [como os materiais internos se relacionam com esta OS]
Se NÃO recebeu materiais internos, escreva: "Sem material interno retornado pela API."

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
📂 = Item identificado via materiais internos (Drive)

⚠️ REGRA CRÍTICA DE COMPLETUDE ⚠️
ANTES de finalizar esta seção, você DEVE:
1) Ler o relatório e classificar os itens em: confirmado, recomendado, verificar.
2) Complementar cada intervenção com os itens NECESSÁRIOS do mesmo subsistema.
3) Garantir que nenhum item essencial da execução ficou de fora.
4) Rodar checklist final por gatilho técnico: se houver intervenção em eixo/mancal/rolamento/suporte de eixo, precisam existir linhas explícitas para ROLAMENTO e RETENTOR (não apenas "conjunto" genérico).
Exemplo: se o relatório indica dano em rolamento/mancal/eixo, completar com os adjacentes necessários (retentor, mancal, eixo, lubrificação de montagem, etc.).
Se o relatório NÃO indica intervenção nesse subsistema, NÃO force itens desse subsistema.
Prioridade máxima: COMPLETAR tecnicamente o relatório, sem inventar.

IMPORTANTE: Liste APENAS itens que serão VENDIDOS/COBRADOS no orçamento:
- Peças solicitadas pelo técnico
- ⚡ Componentes adjacentes necessários conforme diagnóstico e subsistema
- 🌐 Peças e componentes identificados pela PESQUISA WEB que o técnico não mencionou
- 📂 Peças identificadas nos materiais internos (Drive) que o técnico não mencionou
- Insumos de montagem que serão cobrados (veda-rosca, abraçadeiras, conexões...)
- Produtos químicos para limpeza/higienização
- Consumíveis cobráveis (solda, gás refrigerante, óleo...)
- Peças de desgaste natural do equipamento

⛔ NÃO INCLUIR na lista (são ferramentas/recursos internos da equipe, NÃO são vendidos):
- Ferramentas: multímetro, chaves Allen/Torx, chave de fenda, alicate, torquímetro, manifold, bomba de vácuo, etc.
- EPIs: luvas, óculos, capacete, sapato, máscara PFF2, protetor auricular, avental químico, etc.
- Equipamentos de diagnóstico: termômetro infravermelho, detector de vazamento, manômetro (quando usado só para teste), etc.
- Lubrificantes genéricos internos (graxa, lubrificante alimentício) — SÓ inclua se for um insumo específico que será cobrado no orçamento.
A lista é exclusivamente de PEÇAS, COMPONENTES, INSUMOS e QUÍMICOS que entrarão na nota fiscal / orçamento para o cliente.

🏭 POLÍTICAS WEDO
[Listar só as aplicáveis, 1 linha cada]

📝 OBSERVAÇÃO TÉCNICA (reescrita)
[Texto melhorado, máximo 5 linhas]

❓ PERGUNTAS (máx 5)
[Só as que realmente travam o orçamento]

🚦 STATUS: [Pode seguir / Ressalvas / Precisa validar] — [1 frase]

📂🌐 FONTES
- Materiais internos: [listar documentos utilizados ou "nenhum"]
- Fontes web: [listar URLs ou "nenhuma"]

TOM: Telegráfico, técnico, zero enrolação.`;

      const userContentParts: any[] = [];

      // *** PARALLEL: Internal docs + Perplexity web search ***
      const equipForSearch = context?.equipamento || context?.descricao || "";
      console.log(`[genspark-ai] [analyze] Buscando docs internos + web em paralelo para: "${equipForSearch.substring(0, 80)}"`);

      const [internalDocs, webResearch] = await Promise.all([
        fetchInternalTechDocs(equipForSearch, equipForSearch),
        searchEquipmentOnWeb(
          equipForSearch,
          context?.descricao || "",
          context?.orientacao || "",
          context?.pecas || ""
        ),
      ]);

      let textPrompt = `Analise a OS abaixo para apoio à elaboração de orçamento técnico.\n\nDADOS DA OS\n`;
      if (context) {
        textPrompt += `- Cliente: ${context.cliente || "N/A"}\n`;
        textPrompt += `- Técnico: ${context.tecnico || "N/A"}\n`;
        textPrompt += `- Data: ${context.data_tarefa || "N/A"}\n`;
        textPrompt += `- Equipamento: ${context.equipamento || context.descricao || "N/A"}\n`;
        textPrompt += `- ID / Patrimônio / Nº de Série do Equipamento: ${context.equipamento_id || "N/A"}\n`;
        textPrompt += `- Marca/Fabricante identificada: ${internalDocs.manufacturer_identified || "Não identificada"}\n`;
        textPrompt += `- Descrição do equipamento/chamado: ${context.descricao || "N/A"}\n`;
        textPrompt += `- Orientação inicial / descrição do chamado: ${context.orientacao || "N/A"}\n`;
        textPrompt += `- Peças informadas: ${context.pecas || "N/A"}\n`;
        textPrompt += `- Serviços informados: ${context.servicos || "N/A"}\n`;
        textPrompt += `- Tempo informado: ${context.tempo || "N/A"}\n`;
        textPrompt += `- Observações do técnico: ${context.observacoes || "N/A"}\n`;
        if (context.riscos) textPrompt += `- Riscos informados: ${context.riscos}\n`;
        if (context.todas_respostas) textPrompt += `- Respostas do questionário:\n${context.todas_respostas}\n`;
      }

      // Inject internal docs block (ALWAYS present — either with data or explicit "no docs" message)
      textPrompt += buildInternalDocsBlock(internalDocs);

      // Inject web research block (ALWAYS present)
      textPrompt += buildWebBlock(webResearch);

      if (webResearch) {
        textPrompt += `\nINSTRUÇÃO OBRIGATÓRIA: Você RECEBEU dados de pesquisa web acima. Você DEVE:
1. Preencher a seção "🌐 PESQUISA WEB" com os dados encontrados
2. Na seção DIAGNÓSTICO, incluir "Dados da web vs técnico" comparando o que a web diz vs o que o técnico informou
3. Na seção PEÇAS, marcar com 🌐 os itens que vieram da pesquisa web e que o técnico NÃO mencionou
4. Se a web revelou componentes específicos deste modelo que o técnico omitiu, LISTE-OS como ⚡🌐 Recomendar\n`;
      }

      if (internalDocs.docs_count > 0) {
        textPrompt += `\nINSTRUÇÃO OBRIGATÓRIA: Você RECEBEU ${internalDocs.docs_count} documento(s) interno(s). Você DEVE:
1. Preencher a seção "📂 MATERIAIS INTERNOS" com os documentos encontrados
2. Na seção PEÇAS, marcar com 📂 itens fundamentados pelos materiais internos
3. Citar procedimentos ou especificações dos documentos internos quando relevante\n`;
      }

      const hasFotos = context?.fotos?.length > 0;
      textPrompt += `\nFOTOS\n${hasFotos ? `${filterImageUrls(context.fotos).length} foto(s) anexadas. ANALISE CADA FOTO.` : "Não fornecidas"}\n`;

      // Instrução sobre marca/fabricante
      const mfr = internalDocs.manufacturer_identified;
      if (mfr) {
        textPrompt += `\n⚠️ INSTRUÇÃO MARCA/FABRICANTE: A marca identificada é "${mfr.toUpperCase()}". Você DEVE incluir esta marca na seção EQUIPAMENTO no campo "Marca/Fabricante". NÃO omita este campo.\n`;
      } else {
        textPrompt += `\n⚠️ INSTRUÇÃO MARCA/FABRICANTE: A marca NÃO foi identificada automaticamente. Na seção EQUIPAMENTO, escreva "Marca/Fabricante: ⚠️ NÃO IDENTIFICADA". Na seção ❓ PERGUNTAS, inclua OBRIGATORIAMENTE: "Qual é a marca/fabricante deste equipamento? (necessário para busca de materiais técnicos e peças corretas)".\n`;
      }

      textPrompt += `\n⚠️ LEMBRETE FINAL OBRIGATÓRIO: Analise PRIMEIRO o relatório/fotos e classifique o que é confirmado, recomendado e a verificar. Depois complemente tecnicamente com itens necessários do MESMO subsistema. Não force item fora de contexto. Se houver intervenção em suporte do motor/eixo, mancal ou rolamento, detalhe EXPLICITAMENTE em linhas próprias: ROLAMENTO e RETENTOR (além de eixo/mancal quando aplicável), sem esconder em item genérico de conjunto. Mantenha coerência: dano pede troca; lubrificação só para componente funcional.`;

      userContentParts.push({ type: "text", text: textPrompt });

      if (hasFotos) {
        await addPhotosToContent(userContentParts, context.fotos, 6, "high");
      }

      messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: userContentParts });

      console.log(`[genspark-ai] [analyze] cliente=${context?.cliente}, fotos=${context?.fotos?.length || 0}, internalDocs=${internalDocs.docs_count}(${internalDocs.elapsed_ms}ms), webResearch=${webResearch ? "sim" : "não"}, contentParts=${userContentParts.length}`);

    // =========================================================================
    // 3) CONVERSAR SOBRE ESTE ORÇAMENTO
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
- material interno 📂
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
- Base (indicar se veio de: evidência visual, evidência textual, política WeDo, material interno 📂, pesquisa web 🌐, manual/POP)
- Risco de seguir sem validar
- Próximo passo

Se houver dados de PESQUISA WEB no contexto:
- Use-os para fundamentar sua resposta com dados reais
- Cite as fontes relevantes com [fonte]
- Se a web contradizer a análise, explique a divergência
- Marque informações vindas da web com 🌐

Se houver dados de MATERIAIS INTERNOS no contexto:
- Use-os para fundamentar sua resposta
- Marque informações vindas dos materiais internos com 📂

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

      // *** PARALLEL: Internal docs + Perplexity web search ***
      const equipForChat = context?.equipamento || context?.descricao || "";
      console.log(`[genspark-ai] [chat] Buscando docs internos + web em paralelo para: "${equipForChat.substring(0, 80)}"`);

      const [chatInternalDocs, chatWebResearch] = await Promise.all([
        fetchInternalTechDocs(equipForChat, equipForChat),
        searchForChatQuestion(
          userMessage,
          equipForChat,
          context?.orientacao || "",
          analysis || ""
        ),
      ]);

      // Internal docs block
      contextText += buildInternalDocsBlock(chatInternalDocs);

      // Web research block
      if (chatWebResearch) {
        contextText += chatWebResearch;
        contextText += `\n\nINSTRUÇÃO: Você RECEBEU dados de pesquisa web acima. Use-os para fundamentar sua resposta com dados reais. Cite as fontes quando relevante. Se a pesquisa web contradizer algo, explique a divergência.`;
      }

      contextText += `\nPERGUNTA DO USUÁRIO:\n${userMessage}`;

      // Add photos if available
      const hasFotos = context?.fotos?.length > 0;
      if (hasFotos) {
        contextText += `\n\nFOTOS DA OS: ${filterImageUrls(context.fotos).length} foto(s) anexadas. Use-as para responder com mais precisão.`;
      }

      messages.push({ role: "system", content: systemPrompt });

      if (chatHistory && Array.isArray(chatHistory)) {
        for (const msg of chatHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }

      userContentParts.push({ type: "text", text: contextText });
      if (hasFotos) {
        await addPhotosToContent(userContentParts, context.fotos, 6, "low");
      }
      messages.push({ role: "user", content: userContentParts });

      console.log(`[genspark-ai] [chat] cliente=${context?.cliente}, hasAnalysis=${!!analysis}, fotos=${context?.fotos?.length || 0}, internalDocs=${chatInternalDocs.docs_count}(${chatInternalDocs.elapsed_ms}ms), webResearch=${!!chatWebResearch}, msgLength=${userMessage?.length}`);

    } else {
      throw new Error("Ação inválida. Use 'improve', 'analyze', 'chat' ou 'internal_docs_test'.");
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
