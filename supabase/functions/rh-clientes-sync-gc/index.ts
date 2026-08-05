import { installGcUsuarioId } from "../_shared/gc-user.ts";
installGcUsuarioId();

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GC_ACCESS_TOKEN = Deno.env.get("GC_ACCESS_TOKEN") ?? "";
const GC_SECRET_TOKEN = Deno.env.get("GC_SECRET_TOKEN") ?? "";
const GC_BASE = "https://api.gestaoclick.com/api";

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(ltda|me|s\.?a\.?|eireli|epp)\b/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalização simples usada na coluna nome_normalizado (mantém o nome completo). */
function normalizeStored(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const gcH = {
  "access-token": GC_ACCESS_TOKEN,
  "secret-access-token": GC_SECRET_TOKEN,
  "Content-Type": "application/json",
};

async function gcPage(pagina: number): Promise<{ rows: any[]; proxima: boolean }> {
  const res = await fetch(`${GC_BASE}/clientes?pagina=${pagina}`, { headers: gcH });
  if (!res.ok) return { rows: [], proxima: false };
  const json = await res.json().catch(() => null);
  const rows = Array.isArray(json?.data) ? json.data : [];
  return { rows, proxima: Boolean(json?.meta?.proxima_pagina) && rows.length > 0 };
}

/** Baixa TODOS os clientes do GC (paginado, em lotes concorrentes). */
async function gcFetchAll(): Promise<any[]> {
  const all: any[] = [];
  const CONC = 6;
  let pagina = 1;
  for (let bloco = 0; bloco < 40; bloco++) {
    const pages = Array.from({ length: CONC }, (_, i) => pagina + i);
    const res = await Promise.all(pages.map(gcPage));
    let continua = false;
    for (const r of res) {
      all.push(...r.rows);
      if (r.proxima) continua = true;
    }
    pagina += CONC;
    if (!continua) break;
  }
  return all;
}

function firstEndereco(c: any) {
  const raw = Array.isArray(c?.enderecos) ? c.enderecos[0] : null;
  return raw?.endereco ?? raw ?? {};
}

function mapCliente(found: any) {
  const e = firstEndereco(found);
  const endereco = [e.logradouro, e.numero, e.complemento, e.bairro]
    .filter((v: unknown) => v && String(v).trim())
    .join(", ");
  const doc = found.cnpj || found.cpf || found.cpf_cnpj || null;
  return {
    gc_cliente_id: String(found.id ?? found.codigo ?? ""),
    nome_fantasia: found.nome_fantasia ?? found.razao_social ?? null,
    cpf_cnpj: doc ? String(doc).trim() : null,
    email: found.email || null,
    telefone: found.telefone || found.celular || null,
    endereco: endereco || null,
    cidade: e.nome_cidade || null,
    uf: e.estado || null,
    cep: e.cep || null,
    origem: "gc",
    sync_em: new Date().toISOString(),
  } as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const onlyIds: string[] | undefined = body?.ids;

    let query = supabase.from("rh_clientes").select("id, nome, gc_cliente_id, origem");
    if (onlyIds?.length) query = query.in("id", onlyIds);
    else query = query.neq("origem", "manual");

    const { data: alvo, error } = await query.limit(2000);
    if (error) throw error;

    const gcAll = await gcFetchAll();
    const byNome = new Map<string, any>();
    const byId = new Map<string, any>();
    for (const g of gcAll) {
      byId.set(String(g.id), g);
      for (const nome of [g.nome, g.razao_social, g.nome_fantasia]) {
        const k = normalize(String(nome ?? ""));
        if (k && !byNome.has(k)) byNome.set(k, g);
      }
    }

    // IDs GC já ocupados por outra linha (evita violar o índice único)
    const idsOcupados = new Set<string>(
      (alvo ?? []).map((c) => String(c.gc_cliente_id ?? "")).filter(Boolean),
    );

    let updated = 0, errors = 0, naoEncontrados = 0;
    const lista = alvo ?? [];
    const matchedGcIds = new Set<string>();
    for (let i = 0; i < lista.length; i += 10) {
      await Promise.all(lista.slice(i, i + 10).map(async (c) => {
        try {
          const atual = c.gc_cliente_id ? String(c.gc_cliente_id) : "";
          const found = (atual ? byId.get(atual) : null) ?? byNome.get(normalize(c.nome));
          if (!found) { naoEncontrados++; return; }
          matchedGcIds.add(String(found.id));

          const patch = mapCliente(found);
          const gcId = String(patch.gc_cliente_id ?? "");
          if (gcId && gcId !== atual && idsOcupados.has(gcId)) {
            // outro cadastro já usa esse ID: enriquece os dados sem duplicar o vínculo
            delete patch.gc_cliente_id;
          } else if (gcId) {
            idsOcupados.add(gcId);
          }

          const { error: upErr } = await supabase
            .from("rh_clientes").update(patch).eq("id", c.id);
          if (upErr) throw upErr;
          updated++;
        } catch (err) {
          console.error("sync-gc failed for", c.id, err);
          errors++;
        }
      }));
    }

    // Insere clientes que existem no GC mas ainda não estão cadastrados aqui
    let inserted = 0;
    if (!onlyIds?.length) {
      const { data: todos } = await supabase
        .from("rh_clientes").select("nome, gc_cliente_id").limit(5000);
      const existentesIds = new Set<string>(
        (todos ?? []).map((c) => String(c.gc_cliente_id ?? "")).filter(Boolean),
      );
      const existentesNomes = new Set<string>(
        (todos ?? []).map((c) => normalize(String(c.nome ?? ""))).filter(Boolean),
      );

      const novos: Record<string, unknown>[] = [];
      const vistos = new Set<string>();
      for (const g of gcAll) {
        const gcId = String(g.id ?? "");
        const nome = String(g.nome || g.razao_social || g.nome_fantasia || "").trim();
        if (!gcId || !nome) continue;
        if (vistos.has(gcId) || existentesIds.has(gcId) || matchedGcIds.has(gcId)) continue;
        if (existentesNomes.has(normalize(nome))) continue;
        vistos.add(gcId);
        novos.push({
          ...mapCliente(g),
          nome,
          nome_normalizado: normalizeStored(nome),
          ativo: true,
        });
      }

      for (let i = 0; i < novos.length; i += 200) {
        const { error: insErr } = await supabase
          .from("rh_clientes").insert(novos.slice(i, i + 200));
        if (insErr) { console.error("insert failed", insErr); errors++; }
        else inserted += Math.min(200, novos.length - i);
      }
    }

    return new Response(JSON.stringify({
      ok: true, updated, inserted, errors, naoEncontrados,
      gcTotal: gcAll.length, total: alvo?.length ?? 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("rh-clientes-sync-gc error", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});