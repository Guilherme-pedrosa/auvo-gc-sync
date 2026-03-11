import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GC_BASE_URL = "https://api.gestaoclick.com";
const AUVO_BASE_URL = "https://app.auvo.com.br/api/v1.0";
const MIN_DELAY_MS = 400;
let lastGcCall = 0;
let lastAuvoCall = 0;

async function rateLimitedFetch(url: string, options: RequestInit, type: "gc" | "auvo"): Promise<Response> {
  const now = Date.now();
  const last = type === "gc" ? lastGcCall : lastAuvoCall;
  const elapsed = now - last;
  if (elapsed < MIN_DELAY_MS) await new Promise(r => setTimeout(r, MIN_DELAY_MS - elapsed));
  if (type === "gc") lastGcCall = Date.now();
  else lastAuvoCall = Date.now();
  return fetch(url, options);
}

// Situações que NÃO devem ser processadas (já finalizadas)
const SITUACOES_EXCLUIR = [
  "7116099", // Ag. Negociação Financeira
  "7124107", // Com Nota Emitida
  "8760417", // Liberado p/ Faturamento
  "7063724", // Aguardando Pagamento
];

async function fetchOsComTarefaAuvo(gcHeaders: Record<string, string>): Promise<Array<{
  gc_os_id: string;
  gc_os_codigo: string;
  auvo_task_id: string;
  nome_situacao: string;
  situacao_id: string;
}>> {
  const atributoLabel = (Deno.env.get("AUVO_ATRIBUTO_LABEL") || "Tarefa Execução").toLowerCase();
  const results: Array<{
    gc_os_id: string;
    gc_os_codigo: string;
    auvo_task_id: string;
    nome_situacao: string;
    situacao_id: string;
  }> = [];

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${GC_BASE_URL}/api/ordens_servicos?limite=100&pagina=${page}`;
    const response = await rateLimitedFetch(url, { headers: gcHeaders }, "gc");

    if (!response.ok) {
      console.error(`[auvo-gc-sync] GC OS list error: ${response.status}`);
      break;
    }

    const data = await response.json();
    const records: any[] = Array.isArray(data?.data) ? data.data : [];
    totalPages = data?.meta?.total_paginas || 1;

    for (const os of records) {
      const situacaoId = String(os.situacao_id || "");
      if (SITUACOES_EXCLUIR.includes(situacaoId)) continue;

      const atributos: any[] = os.atributos || [];
      const atributoTarefa = atributos.find((a: any) => {
        const label = String(a.label || a.nome || "").toLowerCase();
        return label === atributoLabel || label.includes("tarefa") || label.includes("execu");
      });

      if (!atributoTarefa?.valor || String(atributoTarefa.valor).trim() === "") continue;

      results.push({
        gc_os_id: String(os.id),
        gc_os_codigo: String(os.codigo || os.id),
        auvo_task_id: String(atributoTarefa.valor).trim(),
        nome_situacao: String(os.nome_situacao || ""),
        situacao_id: situacaoId,
      });
    }
    page++;
  }

  return results;
}

async function getAuvoTask(taskId: string, appKey: string, token: string): Promise<{
  taskID: number;
  finished: boolean;
  pendency: string;
  taskStatus: string;
  checkIn: boolean;
  checkOut: boolean;
  report: string;
} | null> {
  const url = `${AUVO_BASE_URL}/tasks/${taskId}?appKey=${appKey}&token=${token}`;

  try {
    const response = await rateLimitedFetch(url, {
      headers: { "Content-Type": "application/json" },
    }, "auvo");

    if (response.status === 404) return null;
    if (!response.ok) {
      console.error(`[auvo-gc-sync] Auvo task ${taskId} error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const entity = data?.result?.Entities?.[0] ?? data?.result?.[0] ?? data;
    if (!entity) return null;

    return {
      taskID: entity.taskID ?? entity.id,
      finished: entity.finished === true || entity.finished === "true",
      pendency: String(entity.pendency ?? entity.pendencia ?? ""),
      taskStatus: String(entity.taskStatus ?? ""),
      checkIn: entity.checkIn === true,
      checkOut: entity.checkOut === true,
      report: String(entity.report ?? ""),
    };
  } catch (err) {
    console.error(`[auvo-gc-sync] Erro ao buscar tarefa ${taskId}:`, err);
    return null;
  }
}

async function atualizarSituacaoOsGC(
  gcOsId: string,
  situacaoId: string,
  gcHeaders: Record<string, string>
): Promise<{ success: boolean; status: number; body: unknown }> {
  const url = `${GC_BASE_URL}/api/ordens_servicos/${gcOsId}`;

  try {
    const response = await rateLimitedFetch(url, {
      method: "PUT",
      headers: gcHeaders,
      body: JSON.stringify({ situacao_id: situacaoId }),
    }, "gc");

    const body = await response.json().catch(() => ({}));
    return { success: response.ok, status: response.status, body };
  } catch (err) {
    return { success: false, status: 0, body: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN");
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN");
    const auvoAppKey = Deno.env.get("AUVO_APP_KEY");
    const auvoToken = Deno.env.get("AUVO_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!gcAccessToken || !gcSecretToken || !auvoAppKey || !auvoToken) {
      return new Response(
        JSON.stringify({ error: "Credenciais não configuradas (GC ou Auvo)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const gcHeaders: Record<string, string> = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    let body: any = {};
    try { body = await req.json(); } catch {}
    const osIdsManual: string[] = body?.os_ids || [];
    const dryRun: boolean = body?.dry_run === true;

    console.log(`[auvo-gc-sync] Iniciando sync. dry_run=${dryRun}`);

    const osCandidatas = await fetchOsComTarefaAuvo(gcHeaders);
    console.log(`[auvo-gc-sync] ${osCandidatas.length} OS com tarefa Auvo encontradas`);

    const logEntries: any[] = [];
    let atualizadas = 0;
    let semPendencia = 0;
    let comPendencia = 0;
    let erros = 0;
    let naoEncontradas = 0;

    for (const os of osCandidatas) {
      if (osIdsManual.length > 0 && !osIdsManual.includes(os.gc_os_id)) continue;

      console.log(`[auvo-gc-sync] Processando OS ${os.gc_os_codigo} → tarefa Auvo ${os.auvo_task_id}`);

      const tarefa = await getAuvoTask(os.auvo_task_id, auvoAppKey, auvoToken);

      if (!tarefa) {
        naoEncontradas++;
        logEntries.push({
          gc_os_id: os.gc_os_id,
          gc_os_codigo: os.gc_os_codigo,
          auvo_task_id: os.auvo_task_id,
          resultado: "nao_encontrada",
          detalhe: "Tarefa não encontrada no Auvo",
          situacao_antes: os.nome_situacao,
          situacao_depois: null,
        });
        continue;
      }

      const finalizadaSemPendencia = tarefa.finished === true &&
        (!tarefa.pendency || tarefa.pendency.trim() === "");

      if (!finalizadaSemPendencia) {
        comPendencia++;
        logEntries.push({
          gc_os_id: os.gc_os_id,
          gc_os_codigo: os.gc_os_codigo,
          auvo_task_id: os.auvo_task_id,
          resultado: tarefa.finished ? "com_pendencia" : "nao_finalizada",
          detalhe: `finished=${tarefa.finished} | pendency="${tarefa.pendency}" | taskStatus=${tarefa.taskStatus}`,
          situacao_antes: os.nome_situacao,
          situacao_depois: null,
        });
        continue;
      }

      semPendencia++;

      if (dryRun) {
        logEntries.push({
          gc_os_id: os.gc_os_id,
          gc_os_codigo: os.gc_os_codigo,
          auvo_task_id: os.auvo_task_id,
          resultado: "dry_run_ok",
          detalhe: "Seria atualizada para situação 7116099",
          situacao_antes: os.nome_situacao,
          situacao_depois: "EXECUTADO – AG. NEGOCIAÇÃO (7116099)",
        });
        continue;
      }

      const gcResult = await atualizarSituacaoOsGC(os.gc_os_id, "7116099", gcHeaders);

      if (gcResult.success) {
        atualizadas++;
        logEntries.push({
          gc_os_id: os.gc_os_id,
          gc_os_codigo: os.gc_os_codigo,
          auvo_task_id: os.auvo_task_id,
          resultado: "atualizada",
          detalhe: `HTTP ${gcResult.status} — situação alterada para 7116099`,
          situacao_antes: os.nome_situacao,
          situacao_depois: "EXECUTADO – AGUARDANDO NEGOCIAÇÃO FINANCEIRA",
        });
      } else {
        erros++;
        logEntries.push({
          gc_os_id: os.gc_os_id,
          gc_os_codigo: os.gc_os_codigo,
          auvo_task_id: os.auvo_task_id,
          resultado: "erro_gc",
          detalhe: `HTTP ${gcResult.status} — ${JSON.stringify(gcResult.body)}`,
          situacao_antes: os.nome_situacao,
          situacao_depois: null,
        });
      }
    }

    const duracao = Date.now() - startTime;

    await supabase.from("auvo_gc_sync_log").insert({
      executado_em: new Date().toISOString(),
      os_candidatas: osCandidatas.length,
      os_atualizadas: atualizadas,
      os_com_pendencia: comPendencia,
      os_sem_pendencia: semPendencia,
      os_nao_encontradas: naoEncontradas,
      erros,
      dry_run: dryRun,
      duracao_ms: duracao,
      detalhes: logEntries,
    });

    const summary = {
      atualizadas, comPendencia, semPendencia, naoEncontradas, erros,
      osCandidatas: osCandidatas.length, dryRun, duracao_ms: duracao,
    };
    console.log("[auvo-gc-sync] Concluído:", summary);

    return new Response(JSON.stringify({ success: true, ...summary, log: logEntries }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[auvo-gc-sync] Erro fatal:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
