import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// =========================================================================
// IMAGE HELPERS
// =========================================================================
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

async function addPhotosToContent(contentParts: any[], fotos: string[], maxPhotos: number, detail: "low" | "high" = "low") {
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
const INTERNAL_DOCS_TIMEOUT = 35000;
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
// IDENTIFY MANUFACTURER — quick Perplexity call
// =========================================================================
function cleanEquipmentString(raw: string): string {
  return raw
    .replace(/\bSERIAL\s+\S+/gi, "")
    .replace(/\bMOD\b/gi, "")
    .replace(/\b[A-Za-z0-9]{8,}\b/g, (match) => {
      const digitRatio = (match.replace(/[^0-9]/g, "").length) / match.length;
      if (match.length <= 8 && digitRatio < 0.6) return match;
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

async function identifyManufacturerAndModel(equipamento: string): Promise<{ manufacturer: string[]; modelFamily: string | null }> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY || !equipamento.trim()) return { manufacturer: [], modelFamily: null };

  try {
    const cleaned = cleanEquipmentString(equipamento);
    console.log(`[genspark-ai] [manufacturer] Identificando fabricante+modelo de: "${cleaned.substring(0, 100)}"`);
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: `Responda em EXATAMENTE 2 linhas:
Linha 1: nome da marca/fabricante (só letras, sem modelo)
Linha 2: nome da FAMÍLIA/LINHA do modelo (ex: iCombi Pro, Ecomax, SCC, CPC, etc.)
Se não souber algum, escreva "desconhecido".
Exemplo para "FORNO RATIONAL 10 GN MOD LM100DE":
Rational
iCombi Pro` },
          { role: "user", content: `Equipamento de cozinha industrial: "${cleaned}". Identifique a marca e a família/linha do modelo.` }
        ],
        temperature: 0.0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[genspark-ai] [manufacturer] Perplexity HTTP ${response.status}: ${errText.substring(0, 100)}`);
      return { manufacturer: [], modelFamily: null };
    }

    const data = await response.json();
    const answer = (data.choices?.[0]?.message?.content || "").trim();
    console.log(`[genspark-ai] [manufacturer] Resultado: "${answer}"`);

    const lines = answer.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    const brandLine = (lines[0] || "").replace(/[0-9]/g, "").replace(/[^a-zA-ZÀ-ÿ\s\-]/g, "").trim();
    const modelLine = (lines[1] || "").trim();

    if (!brandLine || brandLine.toLowerCase() === "desconhecido") return { manufacturer: [], modelFamily: null };

    const terms = brandLine.toLowerCase().split(/[\s\-_]+/).filter((t: string) => t.length > 2);
    const expandedTerms = [...terms];
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

    const modelFamily = (modelLine && modelLine.toLowerCase() !== "desconhecido") ? modelLine : null;
    console.log(`[genspark-ai] [manufacturer] Marca: [${expandedTerms.join(",")}], Modelo: ${modelFamily || "não identificado"}`);
    return { manufacturer: expandedTerms, modelFamily };
  } catch (e) {
    console.warn(`[genspark-ai] [manufacturer] Erro: ${e instanceof Error ? e.message : String(e)}`);
    return { manufacturer: [], modelFamily: null };
  }
}

// =========================================================================
// FETCH INTERNAL TECH DOCS (Drive + OCR)
// =========================================================================
async function fetchInternalTechDocs(query?: string, equipamento?: string, options?: { skipOcr?: boolean; maxDocs?: number; timeout?: number }): Promise<InternalDocsResult> {
  const EFFECTIVE_MAX_DOCS = options?.maxDocs ?? MAX_DOCS;
  const EFFECTIVE_TIMEOUT = options?.timeout ?? INTERNAL_DOCS_TIMEOUT;
  const SKIP_OCR = options?.skipOcr ?? false;
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
    return result;
  }

  const equipStr = cleanEquipmentString(equipamento || query || "");
  const { manufacturer: manufacturerTerms, modelFamily } = await identifyManufacturerAndModel(equipStr);
  result.manufacturer_identified = manufacturerTerms.length > 0 ? manufacturerTerms.join(" ") : null;
  if (modelFamily) {
    (result as any).model_family = modelFamily;
  }

  const functionWords = [
    "lava", "louça", "louças", "lavalouças", "forno", "fogão", "fogao",
    "geladeira", "freezer", "refrigerador", "máquina", "maquina",
    "equipamento", "industrial", "comercial", "profissional",
    "elétrico", "eletrico", "elétrica", "eletrica", "gas", "gás",
    "mesa", "balcão", "balcao", "bancada", "piso", "parede",
    "processador", "cortador", "moedor", "misturador", "batedeira",
    "chapa", "grill", "coifa", "exaustor", "pass", "through",
    "serial", "mod", "modelo",
  ];

  const equipTerms = equipStr
    .toLowerCase()
    .split(/[\s\-_,./]+/)
    .filter((t: string) => t.length > 2)
    .filter((t: string) => !functionWords.includes(t))
    .filter((t: string) => !(t.length >= 8 && /\d/.test(t) && /[a-z]/i.test(t)));

  const modelFamilyTerms: string[] = [];
  if (modelFamily) {
    const mfTerms = modelFamily.toLowerCase().split(/[\s\-_]+/).filter((t: string) => t.length > 1);
    modelFamilyTerms.push(...mfTerms);
  }

  const allTermsSet = new Set([...manufacturerTerms, ...modelFamilyTerms, ...equipTerms]);
  const filterTerms = Array.from(allTermsSet);

  console.log(`[genspark-ai] [internal-docs] Termos: [${filterTerms.join(",")}], modelFamily="${modelFamily || "?"}"`);

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

  const ocrPdfViaVision = async (pdfBytes: Uint8Array, fileName: string): Promise<string> => {
    try {
      let binary = "";
      for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
      const base64Content = btoa(binary);

      const MAX_PAGES = 15;
      const BATCH_SIZE = 5;
      const allTextParts: string[] = [];

      for (let startPage = 1; startPage <= MAX_PAGES; startPage += BATCH_SIZE) {
        if (limitReached()) break;
        const pages: number[] = [];
        for (let p = startPage; p < startPage + BATCH_SIZE && p <= MAX_PAGES; p++) pages.push(p);

        console.log(`[genspark-ai] [OCR] ${fileName} — batch páginas ${pages[0]}-${pages[pages.length - 1]}`);
        const visionUrl = `https://vision.googleapis.com/v1/files:annotate?key=${API_KEY}`;
        const visionResp = await fetch(visionUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: [{
              inputConfig: { content: base64Content, mimeType: "application/pdf" },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              pages,
            }],
          }),
        });

        if (!visionResp.ok) {
          const errBody = await visionResp.text();
          console.error(`[genspark-ai] [OCR] Vision API HTTP ${visionResp.status}: ${errBody.substring(0, 200)}`);
          break;
        }

        const visionData = await visionResp.json();
        const responses = visionData.responses || [];
        for (const resp of responses) {
          const innerPages = resp.responses || [];
          for (const page of innerPages) {
            const fullText = page.fullTextAnnotation?.text;
            if (fullText) allTextParts.push(fullText);
          }
        }
        if (allTextParts.length > 0 && allTextParts.join("").length > 6000) break;
      }

      const ocrText = allTextParts.join("\n\n").trim();
      console.log(`[genspark-ai] [OCR] Vision API retornou ${ocrText.length} chars para ${fileName}`);
      return ocrText;
    } catch (e) {
      console.error(`[genspark-ai] [OCR] Erro Vision API para ${fileName}:`, e instanceof Error ? e.message : String(e));
      return "";
    }
  };

  const isTextFile = (name: string) =>
    /\.(txt|csv|md|json|xml|html|htm|log|ini|cfg|yaml|yml|tsv)$/i.test(name);

  const limitReached = () => totalFilesRead >= EFFECTIVE_MAX_DOCS || totalChars >= MAX_TOTAL_CHARS;

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
      console.error(`[genspark-ai] [internal-docs] Drive list FAILED: HTTP ${resp.status}`);
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

    if (fileSize > 3 * 1024 * 1024) {
      result.skipped_files.push(`${fullPath} (${Math.round(fileSize / 1024 / 1024)}MB — muito grande)`);
      return;
    }

    if (mimeType === "application/vnd.google-apps.document") {
      try {
        const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain&key=${API_KEY}`);
        if (resp.ok) addResult(fullPath, await resp.text());
        else await resp.text();
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
            if (SKIP_OCR) {
              result.skipped_files.push(`${fullPath} (PDF scan — OCR ignorado)`);
            } else {
              const ocrText = await ocrPdfViaVision(buf, fullPath);
              if (ocrText.length > 50) {
                addResult(fullPath, ocrText, "🔍");
              } else {
                result.skipped_files.push(`${fullPath} (PDF scan — OCR sem resultado)`);
              }
            }
          }
        } else await resp.text();
      } catch (e) { console.error(`[genspark-ai] [internal-docs] PDF error ${fullPath}:`, e); }
    }
    else {
      result.skipped_files.push(`${fullPath} (${mimeType})`);
    }
  }

  try {
    const drivePromise = (async () => {
      const topItems = await listFolder(DRIVE_FOLDER_ID);
      const folders = topItems.filter((f: any) => f.mimeType === "application/vnd.google-apps.folder");
      const topFiles = topItems.filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder");

      const scoredFolders = folders.map((f: any) => {
        const nameLower = (f.name || "").toLowerCase();
        let score = 0;
        for (const term of filterTerms) {
          if (nameLower.includes(term)) {
            score += manufacturerTerms.includes(term) ? 5 : 2;
          }
        }
        return { ...f, score };
      }).sort((a: any, b: any) => b.score - a.score);

      const matchingFolders = scoredFolders.filter((f: any) => f.score > 0);
      const foldersToScan = matchingFolders.slice(0, 3);

      for (const file of topFiles) {
        if (limitReached()) break;
        const mime = file.mimeType || "";
        const name = (file.name || "").toLowerCase();
        if (mime === "application/zip" || name.endsWith(".zip")) continue;
        await processFile(file, "");
      }

      const folderListings = await Promise.all(
        foldersToScan.map(async (folder: any) => {
          const subFiles = await listFolder(folder.id);
          return { folder, subFiles };
        })
      );

      const modelTerms = filterTerms.filter((t: string) => !manufacturerTerms.includes(t));
      const allScoredFiles: { file: any; folderName: string; score: number }[] = [];

      for (const { folder, subFiles } of folderListings) {
        for (const f of subFiles) {
          if (f.mimeType === "application/vnd.google-apps.folder") continue;
          const nameLower = (f.name || "").toLowerCase();
          if (f.mimeType === "application/zip" || nameLower.endsWith(".zip")) continue;

          let score = 0;
          for (const term of modelFamilyTerms) {
            if (nameLower.includes(term)) score += 15;
          }
          for (const term of filterTerms) {
            if (nameLower.includes(term)) {
              if (modelFamilyTerms.includes(term)) continue;
              score += manufacturerTerms.includes(term) ? 2 : 5;
            }
          }
          if (modelFamilyTerms.length > 1) {
            const combined = modelFamilyTerms.join(" ");
            if (nameLower.includes(combined)) score += 20;
          }
          if (nameLower.includes("preventiv") || nameLower.includes("manutencao") || nameLower.includes("manutenção")) score += 8;
          if (modelFamily) {
            const otherModels = ["scc", "icombi", "ivario", "selfcookingcenter", "combimaster"];
            for (const other of otherModels) {
              if (!modelFamilyTerms.includes(other) && nameLower.includes(other)) score -= 10;
            }
          }
          allScoredFiles.push({ file: f, folderName: folder.name, score });
        }
      }

      allScoredFiles.sort((a, b) => b.score - a.score);
      for (const { file, folderName } of allScoredFiles) {
        if (limitReached()) break;
        await processFile(file, folderName);
      }
    })();

    await Promise.race([
      drivePromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`Timeout: busca interna excedeu ${EFFECTIVE_TIMEOUT / 1000}s`)), EFFECTIVE_TIMEOUT)),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[genspark-ai] [internal-docs] ERRO: ${msg}`);
    result.error = msg;
  }

  result.docs_count = totalFilesRead;
  result.elapsed_ms = Date.now() - startTime;

  if (results.length > 0) {
    result.text = `MATERIAIS INTERNOS (API Banco Técnico WeDo):\n${results.join("\n\n")}`;
    if (totalChars >= MAX_TOTAL_CHARS) {
      result.text += "\n\n... [truncado — limite de caracteres atingido]";
    }
  }

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
  if (!PERPLEXITY_API_KEY || !query.trim()) return { answer: "", citations: [] };

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
    if (options?.domains && options.domains.length > 0) bodyPayload.search_domain_filter = options.domains;
    if (options?.recency) bodyPayload.search_recency_filter = options.recency;

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
    return {
      answer: data.choices?.[0]?.message?.content || "",
      citations: data.citations || [],
    };
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

  if (!equipClean && !descClean) return "";

  const target = equipClean || descClean;

  const intlQuery = `Commercial/industrial kitchen equipment: "${target}".
Problem/issue: ${oriClean || "general maintenance"}.
Parts mentioned: ${pecasClean || "none specified"}.
I need: 1. Technical specifications 2. Common failures 3. Wear parts list 4. Preventive maintenance 5. Tools/supplies 6. Forum discussions`;

  const brQuery = `Equipamento de cozinha industrial: "${target}".
Problema: ${oriClean || "manutenção geral"}.
Peças: ${pecasClean || "não informadas"}.
Preciso de: 1. Especificações técnicas 2. Problemas comuns 3. Peças de desgaste 4. Manutenção preventiva 5. Ferramentas 6. Fóruns técnicos`;

  const intlSystem = "You are a senior industrial kitchen maintenance engineer. Search ONLY international sources. Respond in pt-BR. Be technical, cite sources.";
  const brSystem = "You are a senior industrial kitchen maintenance engineer. Search ONLY Brazilian sources. Respond in pt-BR. Be technical.";

  const [intlResult, brResult] = await Promise.all([
    searchPerplexity(intlQuery, intlSystem),
    searchPerplexity(brQuery, brSystem),
  ]);

  if (!intlResult.answer && !brResult.answer) return "";

  let result = "PESQUISA WEB (fontes reais da internet):\n";
  if (intlResult.answer) {
    result += `\n🌍 FONTES INTERNACIONAIS:\n${intlResult.answer}`;
    if (intlResult.citations.length > 0) result += `\nFontes: ${intlResult.citations.slice(0, 6).join(", ")}`;
  }
  if (brResult.answer) {
    result += `\n\n🇧🇷 FONTES NACIONAIS:\n${brResult.answer}`;
    if (brResult.citations.length > 0) result += `\nFontes: ${brResult.citations.slice(0, 6).join(", ")}`;
  }
  return result;
}

async function searchForChatQuestion(userMessage: string, equipamento: string, orientacao: string, analysis: string): Promise<string> {
  const equipClean = (equipamento || "").replace(/n\/a/gi, "").trim();
  const target = equipClean || "industrial kitchen equipment";

  const intlQuery = `Equipment: "${target}". ${orientacao ? `Issue: ${orientacao}` : ""} Technical question: ${userMessage}`;
  const brQuery = `Equipamento: "${target}". ${orientacao ? `Problema: ${orientacao}` : ""} Dúvida técnica: ${userMessage}`;

  const intlSystem = "You are a senior industrial kitchen maintenance engineer. Search international sources. Respond in pt-BR.";
  const brSystem = "You are a senior industrial kitchen maintenance engineer. Search Brazilian sources. Respond in pt-BR.";

  const [intlResult, brResult] = await Promise.all([
    searchPerplexity(intlQuery, intlSystem),
    searchPerplexity(brQuery, brSystem),
  ]);

  if (!intlResult.answer && !brResult.answer) return "";

  let result = `\n\n========== 🌐 PESQUISA WEB ==========`;
  if (intlResult.answer) {
    result += `\n\n🌍 FONTES INTERNACIONAIS:\n${intlResult.answer}`;
    if (intlResult.citations.length > 0) result += `\n\nFontes: ${intlResult.citations.slice(0, 5).map((c: string, i: number) => `[${i + 1}] ${c}`).join("\n")}`;
  }
  if (brResult.answer) {
    result += `\n\n🇧🇷 FONTES NACIONAIS:\n${brResult.answer}`;
    if (brResult.citations.length > 0) result += `\n\nFontes: ${brResult.citations.slice(0, 5).map((c: string, i: number) => `[${i + 1}] ${c}`).join("\n")}`;
  }
  result += `\n==========================================================`;
  return result;
}

// =========================================================================
// HELPER: decide se análise precisa do modo expandido
// Gatilhos: conflito forte, equipamento crítico, marca não identificada
// quando essencial, baixa confiança, risco de acidente, pedido explícito
// =========================================================================
interface AnalyzeContext {
  equipamento?: string;
  equipamento_id?: string;
  descricao?: string;
  orientacao?: string;
  pecas?: string;
  servicos?: string;
  observacoes?: string;
  fotos?: string[];
  todas_respostas?: string;
  cliente?: string;
  tecnico?: string;
  data_tarefa?: string;
  [key: string]: any;
}

function shouldExpandAnalysis(context: AnalyzeContext, manufacturerIdentified: string | null): { expand: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const allText = `${context.orientacao || ""} ${context.descricao || ""} ${context.observacoes || ""} ${context.pecas || ""} ${context.todas_respostas || ""}`.toLowerCase();

  // 1. Equipamento crítico (câmara fria, refrigeração, autoclave, caldeira)
  const criticalKeywords = ["câmara fria", "câmara congelada", "camara fria", "camara congelada", "autoclave", "caldeira", "compressor", "refrigeração", "gas refrigerante", "gás refrigerante"];
  if (criticalKeywords.some(k => allText.includes(k))) {
    reasons.push("equipamento_critico");
  }

  // 2. Risco de acidente mencionado
  const riskKeywords = ["vazamento de gás", "vazamento gas", "curto circuito", "curto-circuito", "incêndio", "incendio", "explosão", "explosao", "choque", "risco elétrico", "risco eletrico"];
  if (riskKeywords.some(k => allText.includes(k))) {
    reasons.push("risco_acidente");
  }

  // 3. Marca não identificada E equipamento parece complexo
  const complexKeywords = ["forno", "rational", "combi", "passthrough", "lavalouça", "lava louça", "ultracongelador"];
  if (!manufacturerIdentified && complexKeywords.some(k => allText.includes(k))) {
    reasons.push("marca_nao_identificada_equipamento_complexo");
  }

  // 4. Conflito forte: texto menciona dano/troca mas peças parecem insuficientes
  const damageKeywords = ["danificado", "queimado", "quebrado", "trincado", "vazando", "comprometido", "ausente", "faltando"];
  const hasDamage = damageKeywords.some(k => allText.includes(k));
  const pecasText = (context.pecas || "").trim();
  if (hasDamage && (!pecasText || pecasText.length < 20)) {
    reasons.push("conflito_dano_sem_pecas");
  }

  // 5. Pedido explícito de aprofundamento
  if (/aprofund|detalh|investig|analise completa|análise completa/i.test(allText)) {
    reasons.push("pedido_aprofundamento");
  }

  const expand = reasons.length > 0;
  console.log(`[genspark-ai] [expand-check] expand=${expand}, reasons=[${reasons.join(",")}]`);
  return { expand, reasons };
}

// =========================================================================
// HELPER: build prompt blocks
// =========================================================================
function clampForPrompt(value: string, maxChars: number): string {
  if (!value) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n... [conteúdo truncado para reduzir consumo de tokens]`;
}

function buildInternalDocsBlock(docsResult: InternalDocsResult): string {
  if (docsResult.docs_count > 0 && docsResult.text) {
    const docsText = clampForPrompt(docsResult.text, 9000);
    let block = `\n\n========== 📂 ${docsText} ==========`;
    block += `\nINSTRUÇÃO: Use os materiais internos acima para fundamentar o diagnóstico. Marque com 📂 informações vindas dos materiais internos.\n`;
    if (docsResult.error) {
      block += `\n⚠️ Busca interna parcial (${docsResult.error}). ${docsResult.docs_count} doc(s) carregados em ${docsResult.elapsed_ms}ms.\n`;
    }
    return `${block}\n`;
  }
  let reason = "Nenhum documento retornado";
  if (docsResult.error) reason = `Erro na busca: ${docsResult.error}`;
  return `\n\nMATERIAIS INTERNOS: Sem material interno retornado (${reason}).\n`;
}

function buildWebBlock(webResearch: string): string {
  if (!webResearch) return "";
  const compactWeb = clampForPrompt(webResearch, 6000);
  return `\n\n========== 🌐 DADOS DA PESQUISA WEB ==========\n${compactWeb}\n==========================================================\n`;
}

type AiCallOptions = {
  fallbackModel?: string;
  temperature?: number;
};

// =========================================================================
// AI GATEWAY HELPER — prefer Lovable AI gateway; OpenAI direct only legacy fallback
// =========================================================================
async function callAI(
  messages: any[],
  model: string,
  maxTokens: number,
  options: AiCallOptions = {},
): Promise<{ result: string; error?: string; status?: number }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const temperature = options.temperature ?? 0.35;

  const normalizeGatewayModel = (rawModel: string): string => {
    if (rawModel.startsWith("openai/") || rawModel.startsWith("google/")) return rawModel;
    if (rawModel === "gpt-4o" || rawModel === "gpt-5" || rawModel === "gpt-5.2") return "openai/gpt-5.2";
    if (rawModel === "gpt-4o-mini" || rawModel === "gpt-5-mini") return "openai/gpt-5-mini";
    return "google/gemini-3-flash-preview";
  };

  const pickFallbackModel = (gatewayModel: string): string => {
    if (options.fallbackModel) return options.fallbackModel;
    const map: Record<string, string> = {
      "openai/gpt-5.2": "openai/gpt-5-mini",
      "openai/gpt-5": "openai/gpt-5-mini",
      "openai/gpt-5-mini": "google/gemini-2.5-flash",
      "google/gemini-2.5-pro": "google/gemini-2.5-flash",
      "google/gemini-3.1-pro-preview": "google/gemini-3-flash-preview",
      "google/gemini-3-flash-preview": "google/gemini-2.5-flash",
    };
    return map[gatewayModel] || "google/gemini-2.5-flash";
  };

  const callLovableGateway = async (gatewayModel: string): Promise<Response> => {
    const payload: Record<string, unknown> = {
      model: gatewayModel,
      messages,
      temperature,
    };

    if (gatewayModel.startsWith("openai/gpt-5")) {
      payload.max_completion_tokens = maxTokens;
    } else {
      payload.max_tokens = maxTokens;
    }

    return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  };

  if (LOVABLE_API_KEY) {
    const gatewayModel = normalizeGatewayModel(model);
    const gatewayMaxRetries = 2;
    let response: Response | null = null;

    for (let attempt = 0; attempt <= gatewayMaxRetries; attempt++) {
      console.log(`[genspark-ai] Calling Lovable AI gateway: model=${gatewayModel}, messages=${messages.length}, attempt=${attempt + 1}`);
      response = await callLovableGateway(gatewayModel);

      if (response.status !== 429 || attempt === gatewayMaxRetries) break;

      const waitMs = Math.min(1200 * Math.pow(2, attempt), 8000);
      console.warn(`[genspark-ai] Lovable AI 429 — tentativa ${attempt + 1}, aguardando ${waitMs}ms`);
      await response.text();
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (response && response.status === 429) {
      const fallbackModel = normalizeGatewayModel(pickFallbackModel(gatewayModel));
      if (fallbackModel !== gatewayModel) {
        console.warn(`[genspark-ai] 429 persistente no modelo ${gatewayModel}. Tentando fallback: ${fallbackModel}`);
        const fallbackResponse = await callLovableGateway(fallbackModel);
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          return { result: fallbackData.choices?.[0]?.message?.content || "" };
        }

        const fallbackErrText = await fallbackResponse.text();
        console.error(`[genspark-ai] Fallback model error: ${fallbackResponse.status}`, fallbackErrText.substring(0, 240));
      }
    }

    if (!response || !response.ok) {
      const errText = response ? await response.text() : "no response";
      const status = response?.status || 500;
      console.error(`[genspark-ai] Lovable AI error: ${status}`, errText.substring(0, 240));

      if (status === 429) return { result: "", error: "Serviço de IA congestionado. Tente novamente em alguns segundos.", status: 429 };
      if (status === 402) return { result: "", error: "Créditos de IA insuficientes no workspace.", status: 402 };
      return { result: "", error: `Erro na IA: ${status}`, status };
    }

    const data = await response.json();
    return { result: data.choices?.[0]?.message?.content || "" };
  }

  // Legacy fallback for older projects sem Lovable AI habilitado
  if (!OPENAI_API_KEY) {
    return { result: "", error: "Nenhum provedor de IA configurado no backend", status: 500 };
  }

  let openaiModel = model;
  if (model === "openai/gpt-5.2" || model === "openai/gpt-5") openaiModel = "gpt-4o";
  else if (model === "openai/gpt-5-mini") openaiModel = "gpt-4o-mini";
  else if (model.startsWith("openai/")) openaiModel = "gpt-4o";

  console.log(`[genspark-ai] Calling OpenAI direct (legacy): model=${openaiModel}, messages=${messages.length}`);

  const MAX_RETRIES = 2;
  let response: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: openaiModel, messages, temperature, max_tokens: maxTokens }),
    });

    if (response.status !== 429 || attempt === MAX_RETRIES) break;

    const retryAfter = response.headers.get("retry-after");
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.min(1200 * Math.pow(2, attempt), 8000);
    console.warn(`[genspark-ai] OpenAI 429 — tentativa ${attempt + 1}, aguardando ${waitMs}ms`);
    await response.text();
    await new Promise((r) => setTimeout(r, waitMs));
  }

  if (!response || !response.ok) {
    const errText = response ? await response.text() : "no response";
    const status = response?.status || 500;
    const isInsufficientQuota = /insufficient_quota/i.test(errText);
    console.error("OpenAI API error:", status, errText.substring(0, 240));

    if (status === 429 && isInsufficientQuota) {
      return {
        result: "",
        error: "Quota da OpenAI esgotada no fallback legado. Habilite Lovable AI para continuar.",
        status: 429,
      };
    }

    if (status === 429) {
      return { result: "", error: "Rate limit da OpenAI atingido. Tente novamente em alguns segundos.", status: 429 };
    }

    return { result: "", error: `Erro na API de IA: ${status}`, status };
  }

  const data = await response.json();
  return { result: data.choices?.[0]?.message?.content || "" };
}

// =========================================================================
// MAIN HANDLER
// =========================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action } = body;

    // =====================================================================
    // 0) DIAGNOSTIC MODE — test internal docs fetch
    // =====================================================================
    if (action === "internal_docs_test") {
      const { query, equipamento } = body;
      const searchQuery = query || equipamento || "Rational iCombi";
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
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // =====================================================================
    // 1) MELHORAR PREENCHIMENTO — INTOCADO (action = "improve")
    // Agente: gpt-5-mini (texto) ou gpt-5 (com fotos)
    // =====================================================================
    if (action === "improve") {
      const { text, field, context } = body;
      let model = "openai/gpt-5-mini";

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
- preservar o sentido original
- manter foco técnico e operacional

VOCÊ NÃO DEVE:
- inventar defeitos, peças, códigos, medidas, causas, quantidades ou serviços
- adicionar informações não sustentadas pelo texto original
- transformar hipótese em certeza
- falar de preço, valor, margem ou negociação

REGRAS POR TIPO DE CAMPO

1. PEÇAS NECESSÁRIAS: melhorar nomes, separar itens limpo, não inventar peças
2. SERVIÇOS NECESSÁRIOS: descrever de forma mais clara e técnica
3. TEMPO PARA EXECUÇÃO: padronizar formato, não alterar valor
4. OBSERVAÇÕES: transformar texto solto em observação técnica clara

FORMATO: Retorne apenas o texto melhorado, sem explicação.`;

      const userContentParts: any[] = [];
      let userText = `Melhore o preenchimento do campo abaixo para uso em orçamento técnico.\n\nTIPO DE CAMPO:\n${tipoCampo}\n\nTEXTO ORIGINAL:\n${text}`;

      if (tipoCampo === "OBSERVAÇÕES" && context) {
        if (context.pecas) userText += `\n\nPeças solicitadas: ${context.pecas}`;
        if (context.orientacao) userText += `\nOrientação do serviço: ${context.orientacao}`;
      }

      userContentParts.push({ type: "text", text: userText });

      if (tipoCampo === "OBSERVAÇÕES" && context?.fotos?.length > 0) {
        await addPhotosToContent(userContentParts, context.fotos, 4, "low");
        model = "openai/gpt-5"; // needs vision
      }

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContentParts.length === 1 ? userText : userContentParts },
      ];

      const improveMaxTokens = model === "openai/gpt-5" ? 3200 : 2200;
      const aiResult = await callAI(messages, model, improveMaxTokens, {
        fallbackModel: "openai/gpt-5-mini",
        temperature: 0.25,
      });
      if (aiResult.error) {
        return new Response(JSON.stringify({ error: aiResult.error }), {
          status: aiResult.status || 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ result: aiResult.result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =====================================================================
    // 2) ANALISAR OS PARA ORÇAMENTO — REFATORADO
    // Agente: budget_analysis_agent (openai/gpt-5.2)
    // Modo padrão: texto + até 3 fotos detail:low, SEM web, SEM OCR, SEM docs
    // Modo expandido: gatilho real → web + docs + OCR + mais fotos
    // =====================================================================
    if (action === "analyze") {
      const { context } = body as { context: AnalyzeContext };
      const ANALYSIS_MODEL = "openai/gpt-5.2"; // budget_analysis_agent

      // Step 1: Quick manufacturer identification (always, via Perplexity sonar — cheap)
      const equipForSearch = context?.equipamento || context?.descricao || "";
      const equipStr = cleanEquipmentString(equipForSearch);
      const { manufacturer: mfrTerms, modelFamily } = await identifyManufacturerAndModel(equipStr);
      const manufacturerIdentified = mfrTerms.length > 0 ? mfrTerms.join(" ") : null;

      // Step 2: Decide mode
      const { expand, reasons } = shouldExpandAnalysis(context || {}, manufacturerIdentified);
      console.log(`[genspark-ai] [analyze] MODO=${expand ? "EXPANDIDO" : "PADRÃO"}, equipamento="${equipForSearch.substring(0, 80)}", fabricante="${manufacturerIdentified || "?"}", reasons=[${reasons.join(",")}]`);

      // Step 3: Fetch external data ONLY in expanded mode
      let internalDocs: InternalDocsResult | null = null;
      let webResearch = "";

      if (expand) {
        // Modo expandido: buscar docs internos + web em paralelo
        [internalDocs, webResearch] = await Promise.all([
          fetchInternalTechDocs(equipForSearch, equipForSearch),
          searchEquipmentOnWeb(equipForSearch, context?.descricao || "", context?.orientacao || "", context?.pecas || ""),
        ]);
      }

      // Step 4: Build system prompt — NOVO, enxuto, focado em triagem
      const systemPrompt = `Você é o copiloto de triagem técnica para orçamento da WeDo.

MISSÃO: Ler a OS, validar coerência, apontar inconsistências, sugerir peças/insumos/serviços com cautela e base explícita, indicar lacunas, melhorar a observação técnica.

REGRAS ABSOLUTAS:
- NÃO inventar peças, defeitos, códigos, medidas, causas, procedimentos, quantidades ou conclusões
- NÃO tratar hipótese como fato — se faltar dado, declarar "não informado" ou "não evidenciado"
- Se houver conflito entre texto, fotos, peças e serviços, apontar a inconsistência
- NÃO falar de preço, custo, margem ou valor
- Só sugerir item associado se houver base no texto, foto, material interno ou política WeDo
- Separar FATO / INFERÊNCIA / HIPÓTESE / POLÍTICA WEDO
- NÃO listar EPIs básicos (luvas, óculos, capacete, sapato) — só EPIs ESPECÍFICOS para o serviço
- Se diagnóstico diz DANO/DANIFICADO/QUEIMADO/AUSENTE → ação principal é TROCA, não manutenção preventiva
- Máximo 6 itens associados no modo padrão, expandir apenas se caso realmente complexo

POLÍTICAS WEDO (aplicar apenas quando o gatilho for relevante):
P1) Sujeira/insetos visíveis → dedetização + higienização
P2) Placa eletrônica mencionada → limpeza técnica (álcool isopropílico)
P3) Equipamento Rational (qualquer serviço) → recomendar filtro ar/água, descalcificante, juntas, sensor temp
P4) Componente com fixação sendo trocado → fixadores daquele componente
P5) Peça de desgaste trocada → verificar peças de desgaste do MESMO subsistema
P6) Calcário/sujidade mineral evidenciada → filtro de água, descalcificação
P7) Uso inadequado relatado → treinamento operacional
REGRA: Antes de aplicar política, perguntar "Este equipamento TEM esse componente?"

FORMATO DE SAÍDA OBRIGATÓRIO:

1. 📖 LEITURA TÉCNICA DA OS
- Equipamento aparente:
- Marca/Fabricante: [usar valor fornecido ou "⚠️ NÃO IDENTIFICADA"]
- ID/Série:
- Defeito principal aparente:
- O que está sendo pedido de fato:
- O que está mal descrito ou genérico demais:

2. 🔍 RESUMO DO DIAGNÓSTICO
- Diagnóstico do técnico coerente? [sim / não / parcialmente]
- O que faz sentido:
- O que está inconsistente:
- O que parece principal:
- O que parece acessório:

3. ✅ CHECKLIST PARA ORÇAMENTO
BLOQUEIO: [SIM/NÃO]
Motivo do bloqueio:
Pendências objetivas:
- fotos faltantes
- informação faltante
- identificação faltante
- teste faltante
- evidência não informada

4. 📌 FATOS OBSERVADOS
Para cada fato:
- Fato:
- Evidência:

5. 🤔 INFERÊNCIAS E HIPÓTESES
Para cada inferência:
- Inferência/Hipótese:
- Justificativa:
- Confiança: [baixa / média / alta]
- Precisa validar: [sim / não]

6. 🔧 PEÇAS, INSUMOS E SERVIÇOS ASSOCIADOS
Separar em:
A. Confirmados pelos dados
B. Recomendados por indício técnico
C. Verificar em campo antes de incluir

Para cada item:
[Status] | [Item] | [Tipo: peça/insumo/serviço] | [Motivo] | [Base]
Status: ✅ Confirmado | ⚡ Recomendar | ❓ Verificar
🌐 = Item via pesquisa web | 📂 = Item via materiais internos

Limite padrão: máximo 6 itens

7. 📝 MELHORIA DO PREENCHIMENTO DA OS
- O que faltou descrever melhor:
- O que faltou fotografar:
- O que faltou medir ou testar:
- O que faltou identificar:

8. 📋 OBSERVAÇÃO TÉCNICA MELHORADA
[Reescrever observação de forma profissional, objetiva, útil para orçamento, sem inventar]

9. 🏭 POLÍTICAS WEDO APLICÁVEIS
[Listar apenas as realmente acionadas, 1 linha cada, rotular como "política interna"]

10. ❓ PERGUNTAS QUE DESTRAVAM O ORÇAMENTO
[Máximo 8 perguntas]

11. 🚦 STATUS PARA ORÇAMENTO
Escolher UMA:
- Orçamento pode seguir
- Orçamento pode seguir com ressalvas
- Necessária validação técnica adicional antes do orçamento
Justificar em máximo 3 frases.

TOM: Telegráfico, técnico, zero enrolação. Prefira disciplina e auditabilidade a "texto bonito".`;

      // Step 5: Build user payload
      const userContentParts: any[] = [];
      let textPrompt = `Analise esta OS para triagem técnica de orçamento.\n\nDADOS DA OS\n`;
      if (context) {
        textPrompt += `- Cliente: ${context.cliente || "N/A"}\n`;
        textPrompt += `- Técnico: ${context.tecnico || "N/A"}\n`;
        textPrompt += `- Data: ${context.data_tarefa || "N/A"}\n`;
        textPrompt += `- Equipamento: ${context.equipamento || context.descricao || "N/A"}\n`;
        textPrompt += `- ID / Patrimônio / Série: ${context.equipamento_id || "N/A"}\n`;
        textPrompt += `- Marca/Fabricante identificada: ${manufacturerIdentified || "Não identificada"}\n`;
        textPrompt += `- Família/Linha do modelo: ${modelFamily || "Não identificada"}\n`;
        textPrompt += `- Descrição: ${context.descricao || "N/A"}\n`;
        textPrompt += `- Orientação / chamado: ${context.orientacao || "N/A"}\n`;
        textPrompt += `- Peças informadas: ${context.pecas || "N/A"}\n`;
        textPrompt += `- Serviços informados: ${context.servicos || "N/A"}\n`;
        textPrompt += `- Tempo informado: ${context.tempo || "N/A"}\n`;
        textPrompt += `- Observações do técnico: ${context.observacoes || "N/A"}\n`;
        if (context.todas_respostas) textPrompt += `- Respostas do questionário:\n${context.todas_respostas}\n`;
      }

      // Marca instruction
      if (manufacturerIdentified) {
        textPrompt += `\n⚠️ Marca identificada: "${manufacturerIdentified.toUpperCase()}". Incluir na seção LEITURA TÉCNICA.\n`;
      } else {
        textPrompt += `\n⚠️ Marca NÃO identificada. Na seção LEITURA TÉCNICA, escrever "⚠️ NÃO IDENTIFICADA". Na seção PERGUNTAS, incluir: "Qual é a marca/fabricante deste equipamento?"\n`;
      }

      // Expanded mode: inject docs + web
      if (expand && internalDocs) {
        textPrompt += buildInternalDocsBlock(internalDocs);
        if (internalDocs.docs_count > 0) {
          textPrompt += `\nINSTRUÇÃO: Você RECEBEU ${internalDocs.docs_count} documento(s) interno(s). Preencha seção MATERIAIS INTERNOS e marque itens com 📂.\n`;
        }
      }
      if (expand && webResearch) {
        textPrompt += buildWebBlock(webResearch);
        textPrompt += `\nINSTRUÇÃO: Dados de pesquisa web recebidos. Marque itens vindos da web com 🌐.\n`;
      }

      if (!expand) {
        textPrompt += `\n[MODO PADRÃO] Análise baseada nos dados textuais + fotos da OS. Sem pesquisa web ou docs internos nesta rodada.\n`;
      } else {
        textPrompt += `\n[MODO EXPANDIDO] Motivo: ${reasons.join(", ")}. Dados externos incluídos quando disponíveis.\n`;
      }

      // Photos (economia de tokens no padrão; high só quando leitura de etiqueta/placa é realmente necessária)
      const hasFotos = context?.fotos?.length > 0;
      const photoNeedleText = `${context?.equipamento || ""} ${context?.descricao || ""} ${context?.orientacao || ""} ${context?.observacoes || ""}`.toLowerCase();
      const needsHighDetail = /placa|etiqueta|serial|série|serie|modelo|part number|pn\b|c[oó]digo/i.test(photoNeedleText);
      const maxPhotos = expand ? 4 : 3;
      const photoDetail = expand && needsHighDetail ? "high" as const : "low" as const;
      textPrompt += `\nFOTOS: ${hasFotos ? `${filterImageUrls(context!.fotos!).length} foto(s) anexadas.` : "Não fornecidas"}\n`;

      userContentParts.push({ type: "text", text: textPrompt });
      if (hasFotos) {
        await addPhotosToContent(userContentParts, context!.fotos!, maxPhotos, photoDetail);
      }

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContentParts },
      ];

      console.log(`[genspark-ai] [analyze] mode=${expand ? "expanded" : "standard"}, model=${ANALYSIS_MODEL}, fotos=${context?.fotos?.length || 0}→max${maxPhotos}(${photoDetail}), docs=${internalDocs?.docs_count || 0}, web=${webResearch ? "yes" : "no"}, contentParts=${userContentParts.length}`);

      const analyzeMaxTokens = expand ? 3200 : 2200;
      const aiResult = await callAI(messages, ANALYSIS_MODEL, analyzeMaxTokens, {
        fallbackModel: "openai/gpt-5-mini",
        temperature: 0.2,
      });
      if (aiResult.error) {
        return new Response(JSON.stringify({ error: aiResult.error }), {
          status: aiResult.status || 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ result: aiResult.result, mode: expand ? "expanded" : "standard", reasons }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =====================================================================
    // 3) CHAT CONTEXTUAL DO ORÇAMENTO — REFATORADO
    // Agente: budget_chat_agent (openai/gpt-5-mini)
    // Base principal: análise já gerada + dados da OS
    // SEM web/docs/OCR por padrão — só escala se pergunta exige fonte/manual
    // =====================================================================
    if (action === "chat") {
      const { context, analysis, userMessage, chatHistory } = body;
      const CHAT_MODEL = "openai/gpt-5-mini"; // budget_chat_agent

      const systemPrompt = `Você é o assistente de chat contextual do orçamento da WeDo.

CONTEXTO PRINCIPAL: Você responde com base na análise técnica já gerada e nos dados da OS. NÃO refaça a análise.

OBJETIVO: Ajudar o usuário a tirar dúvidas sobre este orçamento específico.

VOCÊ DEVE:
- Responder dúvidas sobre o diagnóstico
- Explicar por que determinada peça/serviço foi sugerido
- Dizer o que está confirmado, provável ou precisa validar
- Ajudar a decidir se item entra ou não no orçamento
- Apontar o que falta de informação

VOCÊ NÃO DEVE:
- Inventar dados que não estejam neste caso
- Contradizer a análise sem explicar a razão
- Transformar hipótese em certeza
- Falar de preço, margem ou negociação
- Responder genericamente sem se apoiar no caso concreto

FORMATO: Resposta direta com:
- O que está confirmado
- O que é provável
- O que precisa validar
- Base da resposta (evidência visual/textual/política WeDo/análise)

TOM: Técnico, direto, sem floreio.`;

      // Build context from analysis + OS data (lightweight)
      let contextText = `CONTEXTO DO ORÇAMENTO\n\nOS:\n`;
      if (context) {
        contextText += `- Cliente: ${context.cliente || "N/A"}\n`;
        contextText += `- Técnico: ${context.tecnico || "N/A"}\n`;
        contextText += `- Equipamento: ${context.equipamento || "N/A"}\n`;
        contextText += `- ID/Série: ${context.equipamento_id || "N/A"}\n`;
        contextText += `- Orientação: ${context.orientacao || "N/A"}\n`;
        contextText += `- Peças: ${context.pecas || "N/A"}\n`;
        contextText += `- Serviços: ${context.servicos || "N/A"}\n`;
        contextText += `- Observações: ${context.observacoes || "N/A"}\n`;
      }

      if (analysis) {
        contextText += `\nANÁLISE TÉCNICA JÁ GERADA:\n${analysis}\n`;
      }

      // Check if user asks for source/manual/deep info — only then fetch external data
      const needsExternalData = /manual|arquivo|pdf|fonte|material|especificação|especificacao|fabricante|datasheet|catalogo|catálogo/i.test(userMessage || "");

      if (needsExternalData) {
        console.log(`[genspark-ai] [chat] Pergunta pede fonte externa — buscando docs/web`);
        const equipForChat = context?.equipamento || "";
        const [chatDocs, chatWeb] = await Promise.all([
          fetchInternalTechDocs(equipForChat, equipForChat, { skipOcr: true, maxDocs: 2, timeout: 12000 }),
          searchForChatQuestion(userMessage, equipForChat, context?.orientacao || "", analysis || ""),
        ]);

        if (chatDocs.docs_count > 0) {
          contextText += buildInternalDocsBlock(chatDocs);
          contextText += `\nARQUIVOS CONSULTADOS: ${chatDocs.docs_titles.slice(0, 5).join(" | ")}\n`;
        }
        if (chatWeb) {
          contextText += chatWeb;
        }
      }

      contextText += `\nPERGUNTA DO USUÁRIO:\n${userMessage}`;

      const messages: any[] = [{ role: "system", content: systemPrompt }];
      if (chatHistory && Array.isArray(chatHistory)) {
        for (const msg of chatHistory) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      messages.push({ role: "user", content: contextText });

      console.log(`[genspark-ai] [chat] model=${CHAT_MODEL}, hasAnalysis=${!!analysis}, needsExternalData=${needsExternalData}, msgLen=${userMessage?.length}`);

      const aiResult = await callAI(messages, CHAT_MODEL, 1800, {
        fallbackModel: "google/gemini-2.5-flash",
        temperature: 0.2,
      });
      if (aiResult.error) {
        return new Response(JSON.stringify({ error: aiResult.error }), {
          status: aiResult.status || 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ result: aiResult.result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // =====================================================================
    // 4) ANÁLISE APROFUNDADA — budget_deep_analysis_agent
    // Mesmo modelo do analyze, mas SEMPRE modo expandido
    // Ativado por pedido explícito do usuário
    // =====================================================================
    if (action === "deep_analyze") {
      // Redireciona para analyze com flag forceExpand
      const { context } = body as { context: AnalyzeContext };
      const DEEP_MODEL = "openai/gpt-5.2";

      const equipForSearch = context?.equipamento || context?.descricao || "";
      const equipStr = cleanEquipmentString(equipForSearch);
      const { manufacturer: mfrTerms, modelFamily } = await identifyManufacturerAndModel(equipStr);
      const manufacturerIdentified = mfrTerms.length > 0 ? mfrTerms.join(" ") : null;

      console.log(`[genspark-ai] [deep_analyze] MODO EXPANDIDO FORÇADO`);

      const [internalDocs, webResearch] = await Promise.all([
        fetchInternalTechDocs(equipForSearch, equipForSearch),
        searchEquipmentOnWeb(equipForSearch, context?.descricao || "", context?.orientacao || "", context?.pecas || ""),
      ]);

      // Reuse same system prompt as analyze
      const systemPrompt = `Você é o copiloto de triagem técnica para orçamento da WeDo operando em MODO APROFUNDADO.

MISSÃO: Análise técnica completa com consulta a documentos internos e pesquisa web.
Use TODAS as fontes disponíveis para fundamentar o diagnóstico.

[Mesmo formato de saída da análise padrão, mas com permissão para expandir além de 6 itens se necessário e incluir mais detalhes técnicos das fontes externas.]

REGRAS: Mesmas da análise padrão — NÃO inventar, separar fato/inferência/hipótese, sem preços.

FORMATO: Mesmo formato de 11 seções da análise padrão.

TOM: Telegráfico, técnico, fundamentado.`;

      const userContentParts: any[] = [];
      let textPrompt = `ANÁLISE APROFUNDADA — Consulta completa a docs internos e web.\n\nDADOS DA OS\n`;
      if (context) {
        textPrompt += `- Cliente: ${context.cliente || "N/A"}\n`;
        textPrompt += `- Equipamento: ${context.equipamento || "N/A"}\n`;
        textPrompt += `- Marca: ${manufacturerIdentified || "Não identificada"}\n`;
        textPrompt += `- Modelo: ${modelFamily || "Não identificado"}\n`;
        textPrompt += `- Orientação: ${context.orientacao || "N/A"}\n`;
        textPrompt += `- Peças: ${context.pecas || "N/A"}\n`;
        textPrompt += `- Serviços: ${context.servicos || "N/A"}\n`;
        textPrompt += `- Observações: ${context.observacoes || "N/A"}\n`;
        if (context.todas_respostas) textPrompt += `- Questionário:\n${context.todas_respostas}\n`;
      }

      if (internalDocs) textPrompt += buildInternalDocsBlock(internalDocs);
      if (webResearch) textPrompt += buildWebBlock(webResearch);

      const hasFotos = context?.fotos?.length > 0;
      const deepPhotoNeedleText = `${context?.equipamento || ""} ${context?.descricao || ""} ${context?.orientacao || ""} ${context?.observacoes || ""}`.toLowerCase();
      const deepNeedsHighDetail = /placa|etiqueta|serial|série|serie|modelo|part number|pn\b|c[oó]digo/i.test(deepPhotoNeedleText);
      textPrompt += `\nFOTOS: ${hasFotos ? `${filterImageUrls(context!.fotos!).length} foto(s)` : "Não fornecidas"}\n`;

      userContentParts.push({ type: "text", text: textPrompt });
      if (hasFotos) {
        await addPhotosToContent(userContentParts, context!.fotos!, 5, deepNeedsHighDetail ? "high" : "low");
      }

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContentParts },
      ];

      const aiResult = await callAI(messages, DEEP_MODEL, 3800, {
        fallbackModel: "openai/gpt-5-mini",
        temperature: 0.2,
      });
      if (aiResult.error) {
        return new Response(JSON.stringify({ error: aiResult.error }), {
          status: aiResult.status || 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ result: aiResult.result, mode: "deep", docs: internalDocs?.docs_count || 0, web: !!webResearch }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Ação inválida. Use 'improve', 'analyze', 'chat', 'deep_analyze' ou 'internal_docs_test'.");

  } catch (e) {
    console.error("genspark-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
