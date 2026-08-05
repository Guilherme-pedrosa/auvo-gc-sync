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

    let updated = 0, errors = 0, naoEncontrados = 0;
    for (const c of alvo ?? []) {
      try {
        const found =
          (c.gc_cliente_id ? byId.get(String(c.gc_cliente_id)) : null) ??
          byNome.get(normalize(c.nome));
        if (!found) { naoEncontrados++; continue; }

        const { error: upErr } = await supabase
          .from("rh_clientes").update(mapCliente(found)).eq("id", c.id);
        if (upErr) throw upErr;
        updated++;
      } catch (err) {
        console.error("sync-gc failed for", c.id, err);
        errors++;
      }
    }

    return new Response(JSON.stringify({
      ok: true, updated, errors, naoEncontrados,
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