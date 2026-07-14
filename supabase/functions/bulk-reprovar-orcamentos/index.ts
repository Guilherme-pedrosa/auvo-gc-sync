import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GC_BASE_URL = "https://api.gestaoclick.com";
const SITUACAO_ORIGEM = "7063588"; // Aguardando Aprovação
const SITUACAO_DESTINO = "7841143"; // NÃO APROVADO

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const gcAccessToken = Deno.env.get("GC_ACCESS_TOKEN")!;
    const gcSecretToken = Deno.env.get("GC_SECRET_TOKEN")!;

    const authHeader = req.headers.get("Authorization") || "";
    const admin = createClient(supabaseUrl, serviceRoleKey);
    let userId: string | null = null;

    // Auth: aceita (a) service role bearer (invocação admin direta) ou (b) usuário com role admin
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (bearer && bearer === serviceRoleKey) {
      userId = null; // invocação de serviço
    } else {
      if (!authHeader) return ok({ ok: false, error: "Não autorizado" }, 401);
      const callerClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await callerClient.auth.getUser();
      if (!user) return ok({ ok: false, error: "Não autorizado" }, 401);
      const { data: isAdmin } = await admin.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (!isAdmin) return ok({ ok: false, error: "Requer admin" }, 403);
      userId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "preview");
    const anoLimite = Number(body?.ano_limite || 2025);
    const batchSize = Math.min(Number(body?.batch_size || 40), 80);
    const offset = Math.max(Number(body?.offset || 0), 0);
    const targetIds: string[] = Array.isArray(body?.target_ids)
      ? body.target_ids.map((x: unknown) => String(x))
      : [];

    // Lista alvo do cache
    const { data: cache } = await admin
      .from("followup_kanban_cache")
      .select("gc_orcamento_id, dados")
      .eq("coluna", SITUACAO_ORIGEM);
    let alvos = (cache || [])
      .filter((r: any) => {
        const d = String(r?.dados?.data || "");
        const ano = Number(d.slice(0, 4));
        return ano && ano <= anoLimite;
      })
      .map((r: any) => ({
        id: String(r.gc_orcamento_id),
        codigo: String(r?.dados?.gc_orcamento_codigo || ""),
        cliente: String(r?.dados?.cliente || ""),
        data: String(r?.dados?.data || ""),
      }))
      .sort((a: any, b: any) => a.data.localeCompare(b.data));
    if (targetIds.length > 0) {
      const set = new Set(targetIds);
      alvos = targetIds.map((id) => {
        const found = alvos.find((a) => a.id === id);
        return found || { id, codigo: "", cliente: "", data: "" };
      });
      alvos = alvos.filter((a) => set.has(a.id));
    }

    if (action === "preview") {
      return ok({ ok: true, total: alvos.length, amostra: alvos.slice(0, 5) });
    }

    if (action !== "execute") {
      return ok({ ok: false, error: `action desconhecida: ${action}` });
    }

    const slice = alvos.slice(offset, offset + batchSize);
    const gcHeaders = {
      "access-token": gcAccessToken,
      "secret-access-token": gcSecretToken,
      "Content-Type": "application/json",
    };

    const results: any[] = [];
    let alterados = 0, pulados = 0, erros = 0;

    for (const alvo of slice) {
      try {
        // GET
        let getResp: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          getResp = await fetch(`${GC_BASE_URL}/api/orcamentos/${alvo.id}`, { headers: gcHeaders });
          if (getResp.status === 429) { await sleep(3000 + attempt * 2000); continue; }
          break;
        }
        const getJson: any = await (getResp as Response).json().catch(() => ({}));
        const orc = getJson?.data ?? getJson;
        if (!orc || typeof orc !== "object" || !orc.id) {
          erros++;
          results.push({ id: alvo.id, codigo: alvo.codigo, status: "erro", motivo: `GET falhou (HTTP ${getResp?.status})` });
          continue;
        }
        const situacaoAtual = String(orc.situacao_id || "");
        if (situacaoAtual !== SITUACAO_ORIGEM) {
          pulados++;
          results.push({ id: alvo.id, codigo: alvo.codigo, status: "pulado", motivo: `situação atual ${situacaoAtual}` });
          // remove do cache pra não reprocessar
          await admin.from("followup_kanban_cache").delete().eq("gc_orcamento_id", alvo.id);
          continue;
        }

        const stamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
        const obsAtual = String(orc.observacao || "");
        const linha = `\n\n[${stamp}] REPROVADO EM MASSA (2025 e anteriores) — situação alterada para NÃO APROVADO.`;
        const novaObs = (obsAtual + linha).trim();

        const payload: Record<string, unknown> = {
          ...orc,
          situacao_id: SITUACAO_DESTINO,
          observacao: novaObs,
        };
        for (const f of ["id", "codigo", "nome_situacao", "cor_situacao", "hash", "cadastrado_em", "modificado_em"]) {
          delete (payload as any)[f];
        }
        // Força tudo a 2 casas decimais e alinha pagamentos ao valor_total recalculado
        // (bug do GC: valor_venda com 4 casas × quantidade gera divergência de R$ 0,01).
        const round2 = (v: unknown): number => {
          const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
          return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
        };

        let totalProdutos = 0;
        if (Array.isArray((payload as any).produtos)) {
          (payload as any).produtos = (payload as any).produtos.map((wrap: any) => {
            const p = wrap?.produto ?? wrap;
            const qtd = parseFloat(String(p?.quantidade ?? "1")) || 0;
            const vvenda = round2(p?.valor_venda);
            const vtotal = round2(qtd * venda);
            totalProdutos += vtotal;
            return {
              produto: {
                ...p,
                valor_venda: venda.toFixed(2),
                valor_custo: round2(p?.valor_custo).toFixed(2),
                valor_total: vtotal.toFixed(2),
                desconto_valor: p?.desconto_valor ? round2(p.desconto_valor).toFixed(2) : p?.desconto_valor,
              },
            };
          });
        }
        let totalServicos = 0;
        if (Array.isArray((payload as any).servicos)) {
          (payload as any).servicos = (payload as any).servicos.map((wrap: any) => {
            const s = wrap?.servico ?? wrap;
            const qtd = parseFloat(String(s?.quantidade ?? "1")) || 0;
            const vvenda = round2(s?.valor_venda);
            const vtotal = round2(qtd * vvenda);
            totalServicos += vtotal;
            return {
              servico: {
                ...s,
                valor_venda: vvenda.toFixed(2),
                valor_custo: round2(s?.valor_custo).toFixed(2),
                valor_total: vtotal.toFixed(2),
                desconto_valor: s?.desconto_valor ? round2(s.desconto_valor).toFixed(2) : s?.desconto_valor,
              },
            };
          });
        }
        const descontoValor = round2((payload as any).desconto_valor);
        const valorFrete = round2((payload as any).valor_frete);
        const novoTotal = round2(totalProdutos + totalServicos + valorFrete - descontoValor);
        (payload as any).valor_produtos = totalProdutos.toFixed(2);
        (payload as any).valor_servicos = totalServicos.toFixed(2);
        (payload as any).valor_frete = valorFrete.toFixed(2);
        (payload as any).desconto_valor = descontoValor.toFixed(2);
        (payload as any).valor_total = novoTotal.toFixed(2);

        // Alinha pagamentos: 1 única parcela com o total recalculado
        if (Array.isArray((payload as any).pagamentos) && (payload as any).pagamentos.length > 0) {
          const first = (payload as any).pagamentos[0]?.pagamento ?? (payload as any).pagamentos[0];
          (payload as any).pagamentos = [
            { pagamento: { ...first, valor: novoTotal.toFixed(2) } },
          ];
          (payload as any).numero_parcelas = "1";
        }

        let putResp: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          putResp = await fetch(`${GC_BASE_URL}/api/orcamentos/${alvo.id}`, {
            method: "PUT",
            headers: gcHeaders,
            body: JSON.stringify(payload),
          });
          if (putResp.status === 429) { await sleep(3000 + attempt * 2000); continue; }
          break;
        }
        const putJson: any = await (putResp as Response).json().catch(() => ({}));
        const success = (putResp as Response).ok && putJson?.code !== 400;

        await admin.from("orcamento_aprovacao_log").insert({
          gc_orcamento_id: alvo.id,
          gc_orcamento_codigo: alvo.codigo || String(orc.codigo || ""),
          cliente: String(orc.nome_cliente || alvo.cliente),
          acao: "bulk_reject",
          situacao_id_antes: SITUACAO_ORIGEM,
          situacao_id_depois: success ? SITUACAO_DESTINO : null,
          observacao: null,
          termo_aceito: false,
          user_id: userId,
          user_nome: null,
          user_email: null,
          ip: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip"),
          user_agent: req.headers.get("user-agent"),
          detalhes: { http_status: (putResp as Response).status, gc_response: putJson },
        });

        if (success) {
          alterados++;
          results.push({ id: alvo.id, codigo: alvo.codigo, status: "ok" });
          await admin.from("followup_kanban_cache").delete().eq("gc_orcamento_id", alvo.id);
          await admin.from("orcamento_detalhe_cache").delete().eq("gc_orcamento_id", alvo.id);
        } else {
          erros++;
          results.push({ id: alvo.id, codigo: alvo.codigo, status: "erro", motivo: `PUT HTTP ${(putResp as Response).status}`, body: putJson });
        }
        // throttle pra não bater 429
        await sleep(250);
      } catch (e) {
        erros++;
        results.push({ id: alvo.id, codigo: alvo.codigo, status: "erro", motivo: (e as Error).message });
      }
    }

    return ok({
      ok: true,
      total_alvos: alvos.length,
      offset,
      processados: slice.length,
      proximo_offset: offset + slice.length,
      finalizado: offset + slice.length >= alvos.length,
      alterados,
      pulados,
      erros,
      results,
    });
  } catch (e) {
    console.error("[bulk-reprovar-orcamentos] erro", e);
    return ok({ ok: false, error: (e as Error).message });
  }
});