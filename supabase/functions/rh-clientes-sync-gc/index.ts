import { installGcUsuarioId } from "../_shared/gc-user.ts";
installGcUsuarioId();

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GC_ACCESS_TOKEN = Deno.env.get("GC_ACCESS_TOKEN") ?? "";
const GC_SECRET_TOKEN = Deno.env.get("GC_SECRET_TOKEN") ?? "";
const AUVO_APP_KEY = Deno.env.get("AUVO_APP_KEY") ?? "";
const AUVO_TOKEN = Deno.env.get("AUVO_TOKEN") ?? "";
const GC_BASE = "https://api.gestaoclick.com/api";
const AUVO_BASE = "https://api.auvo.com.br/v2";

type AuvoCustomer = {
  id: number;
  externalId: string | null;
  name: string;
  legalName: string | null;
  cpfCnpj: string | null;
  active: boolean;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
};

type LocalCustomer = {
  id: string;
  nome: string;
  nome_auvo: string | null;
  nome_normalizado: string;
  gc_cliente_id: string | null;
  auvo_cliente_id: number | null;
  origem: string;
};

function normalize(value: string | null | undefined): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(ltda|me|s\.?a\.?|eireli|epp|mei)\b/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStored(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function digits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function asList<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

const gcHeaders = {
  "access-token": GC_ACCESS_TOKEN,
  "secret-access-token": GC_SECRET_TOKEN,
  "Content-Type": "application/json",
};

async function gcPage(page: number): Promise<{ rows: any[]; hasNext: boolean }> {
  const response = await fetch(`${GC_BASE}/clientes?pagina=${page}&limite=100`, { headers: gcHeaders });
  const raw = await response.text();
  if (response.status === 404) return { rows: [], hasNext: false };
  if (!response.ok) throw new Error(`GestãoClick /clientes página ${page} respondeu ${response.status}: ${raw.slice(0, 300)}`);
  const json = raw ? JSON.parse(raw) : {};
  const rows = Array.isArray(json?.data) ? json.data : [];
  return { rows, hasNext: Boolean(json?.meta?.proxima_pagina) && rows.length > 0 };
}

async function fetchAllGcCustomers(): Promise<any[]> {
  const all: any[] = [];
  // GestãoClick limita a 3 chamadas/s. Três páginas por bloco respeitam o limite.
  for (let firstPage = 1; firstPage <= 300; firstPage += 3) {
    const pages = [firstPage, firstPage + 1, firstPage + 2];
    const results = await Promise.all(pages.map(gcPage));
    for (const result of results) all.push(...result.rows);
    if (!results.some((result) => result.hasNext)) break;
    await new Promise((resolve) => setTimeout(resolve, 1050));
  }
  return all;
}

async function auvoLogin(): Promise<string> {
  if (!AUVO_APP_KEY || !AUVO_TOKEN) throw new Error("Credenciais do Auvo não configuradas");
  const response = await fetch(
    `${AUVO_BASE}/login/?apiKey=${encodeURIComponent(AUVO_APP_KEY)}&apiToken=${encodeURIComponent(AUVO_TOKEN)}`,
    { headers: { "Content-Type": "application/json" } },
  );
  const data = await response.json().catch(() => ({}));
  const accessToken = data?.result?.accessToken;
  if (!response.ok || !accessToken) throw new Error(`Login no Auvo falhou (${response.status})`);
  return String(accessToken);
}

function auvoHeaders(accessToken: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };
}

function mapAuvoCustomer(raw: any): AuvoCustomer | null {
  const id = Number(raw?.customerId ?? raw?.id);
  const name = String(raw?.name ?? raw?.tradeName ?? raw?.description ?? raw?.legalName ?? "").trim();
  if (!Number.isFinite(id) || id <= 0 || !name) return null;
  return {
    id,
    externalId: String(raw?.externalId || "").trim() || null,
    name,
    legalName: String(raw?.legalName || raw?.companyName || "").trim() || null,
    cpfCnpj: digits(raw?.cpfCnpj || raw?.cpf_cnpj) || null,
    active: raw?.active !== false,
    address: String(raw?.address || "").trim() || null,
    city: String(raw?.city || raw?.billingCity || "").trim() || null,
    state: String(raw?.state || raw?.billingState || "").trim() || null,
    zipCode: digits(raw?.zipCode || raw?.billingZipCode) || null,
  };
}

async function fetchAllAuvoCustomers(accessToken: string): Promise<AuvoCustomer[]> {
  const all: AuvoCustomer[] = [];
  for (let page = 1; page <= 300; page++) {
    const filter = encodeURIComponent(JSON.stringify({}));
    const response = await fetch(
      `${AUVO_BASE}/customers/?paramFilter=${filter}&page=${page}&pageSize=100&order=asc`,
      { headers: auvoHeaders(accessToken) },
    );
    if (response.status === 404) break;
    const raw = await response.text();
    if (!response.ok) throw new Error(`Auvo /customers página ${page} respondeu ${response.status}: ${raw.slice(0, 300)}`);
    const json = raw ? JSON.parse(raw) : {};
    const list = json?.result?.entityList ?? json?.result ?? [];
    if (!Array.isArray(list) || list.length === 0) break;
    for (const item of list) {
      const mapped = mapAuvoCustomer(item);
      if (mapped) all.push(mapped);
    }
    const total = Number(json?.result?.pagedSearchReturnData?.totalItems || 0);
    if (list.length < 100 || (total > 0 && all.length >= total)) break;
  }
  return all;
}

function firstGcAddress(customer: any): any {
  const raw = Array.isArray(customer?.enderecos) ? customer.enderecos[0] : null;
  return raw?.endereco ?? raw ?? {};
}

function gcName(customer: any): string {
  return String(customer?.nome || customer?.razao_social || customer?.nome_fantasia || "").trim();
}

function gcDocument(customer: any): string {
  return digits(customer?.cnpj || customer?.cpf || customer?.cpf_cnpj);
}

function gcPatch(customer: any): Record<string, unknown> {
  const address = firstGcAddress(customer);
  const name = gcName(customer);
  const fullAddress = [address.logradouro, address.numero, address.complemento, address.bairro]
    .filter((value: unknown) => String(value || "").trim())
    .join(", ");
  return {
    gc_cliente_id: String(customer?.id ?? customer?.codigo ?? ""),
    nome: name,
    nome_gc: name,
    nome_normalizado: normalizeStored(name),
    nome_fantasia: customer?.nome_fantasia ?? customer?.razao_social ?? null,
    cpf_cnpj: gcDocument(customer) || null,
    email: customer?.email || null,
    telefone: customer?.telefone || customer?.celular || null,
    endereco: fullAddress || null,
    cidade: address.nome_cidade || null,
    uf: address.estado || null,
    cep: digits(address.cep) || null,
    ativo: true,
    sync_em: new Date().toISOString(),
  };
}

function auvoPayload(customer: any): Record<string, unknown> {
  const address = firstGcAddress(customer);
  const gcId = String(customer?.id ?? customer?.codigo ?? "");
  const name = gcName(customer);
  const document = gcDocument(customer);
  const fullAddress = [address.logradouro, address.numero, address.complemento, address.bairro, address.nome_cidade, address.estado]
    .filter((value: unknown) => String(value || "").trim())
    .join(", ");
  return {
    externalId: `GC:${gcId}`,
    name,
    legalName: String(customer?.razao_social || "").trim() || undefined,
    phoneNumber: asList(customer?.telefone || customer?.celular).map((value) => digits(value)).filter(Boolean),
    email: asList(customer?.email).map(String).filter(Boolean),
    cpfCnpj: document || undefined,
    address: fullAddress || undefined,
    active: true,
    replaceData: false,
    identifierBycpfCnpj: document.length === 11 || document.length === 14,
  };
}

async function upsertCustomerInAuvo(customer: any, accessToken: string): Promise<AuvoCustomer> {
  const response = await fetch(`${AUVO_BASE}/customers/`, {
    method: "PUT",
    headers: auvoHeaders(accessToken),
    body: JSON.stringify(auvoPayload(customer)),
  });
  const raw = await response.text();
  const json = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw new Error(`Auvo recusou cliente GC ${customer?.id} (${response.status}): ${raw.slice(0, 500)}`);
  const mapped = mapAuvoCustomer(json?.result ?? json);
  if (!mapped) throw new Error(`Auvo criou/atualizou cliente GC ${customer?.id}, mas não devolveu o ID`);
  return mapped;
}

function addMulti(map: Map<string, AuvoCustomer[]>, key: string, customer: AuvoCustomer): void {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key)!.some((existing) => existing.id === customer.id)) {
    map.get(key)!.push(customer);
  }
}

function uniqueMatch(map: Map<string, AuvoCustomer[]>, key: string): AuvoCustomer | null {
  const values = key ? map.get(key) ?? [] : [];
  return values.length === 1 ? values[0] : null;
}

async function handleManualLink(supabase: any, body: any): Promise<Record<string, unknown>> {
  const rhClientId = String(body?.rhClientId || "").trim();
  const rawAuvoId = body?.auvoCustomerId;
  const auvoCustomerId = rawAuvoId === null || rawAuvoId === "" ? null : Number(rawAuvoId);
  if (!rhClientId) throw new Error("Cliente central não informado");
  if (auvoCustomerId !== null && (!Number.isFinite(auvoCustomerId) || auvoCustomerId <= 0)) {
    throw new Error("Cliente Auvo inválido");
  }

  const { data: target, error: targetError } = await supabase
    .from("rh_clientes")
    .select("id, gc_cliente_id, origem, nome_auvo")
    .eq("id", rhClientId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("Cliente central não encontrado");

  if (auvoCustomerId === null) {
    const { error } = await supabase.from("rh_clientes").update({
      auvo_cliente_id: null,
      nome_auvo: null,
      auvo_external_id: null,
      vinculo_status: "pendente",
      vinculo_metodo: "desvinculado_manualmente",
      vinculo_confianca: null,
      auvo_sync_em: null,
      auvo_sync_erro: null,
      origem: target.gc_cliente_id ? "gc" : "manual",
      atualizado_em: new Date().toISOString(),
    }).eq("id", rhClientId);
    if (error) throw error;
    return { ok: true, mergedClientId: null };
  }

  const { data: auvo, error: auvoError } = await supabase
    .from("auvo_clientes_cache")
    .select("auvo_id, nome, external_id")
    .eq("auvo_id", auvoCustomerId)
    .maybeSingle();
  if (auvoError) throw auvoError;
  if (!auvo) throw new Error("Cliente não encontrado no espelho do Auvo. Sincronize antes de vincular.");

  const { data: holder, error: holderError } = await supabase
    .from("rh_clientes")
    .select("id")
    .eq("auvo_cliente_id", auvoCustomerId)
    .neq("id", rhClientId)
    .maybeSingle();
  if (holderError) throw holderError;

  // O cliente Auvo pode já existir como uma linha isolada. Antes de unir as
  // linhas, transfere os relacionamentos do RH para não apagar histórico.
  if (holder?.id) {
    const { data: requirements, error: reqError } = await supabase
      .from("rh_client_requirements")
      .select("document_type_id, required_for, is_required, observacoes")
      .eq("client_id", holder.id);
    if (reqError) throw reqError;
    if (requirements?.length) {
      const { error } = await supabase.from("rh_client_requirements").upsert(
        requirements.map((row: any) => ({ ...row, client_id: rhClientId })),
        { onConflict: "client_id,document_type_id,required_for" },
      );
      if (error) throw error;
    }

    const { error: integrationsError } = await supabase
      .from("rh_integrations")
      .update({ client_id: rhClientId })
      .eq("client_id", holder.id);
    if (integrationsError) throw integrationsError;

    const { data: sharedLinks, error: sharedError } = await supabase
      .from("rh_integration_clients")
      .select("integration_id")
      .eq("client_id", holder.id);
    if (sharedError) throw sharedError;
    if (sharedLinks?.length) {
      const { error } = await supabase.from("rh_integration_clients").upsert(
        sharedLinks.map((row: any) => ({ integration_id: row.integration_id, client_id: rhClientId })),
        { onConflict: "integration_id,client_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    }

    const { error: deleteError } = await supabase.from("rh_clientes").delete().eq("id", holder.id);
    if (deleteError) throw deleteError;
  }

  const { error: updateError } = await supabase.from("rh_clientes").update({
    auvo_cliente_id: auvo.auvo_id,
    nome_auvo: auvo.nome,
    auvo_external_id: auvo.external_id,
    vinculo_status: "vinculado",
    vinculo_metodo: "manual",
    vinculo_confianca: 1,
    auvo_sync_em: new Date().toISOString(),
    auvo_sync_erro: null,
    origem: target.gc_cliente_id ? "gc_auvo" : "auvo",
    atualizado_em: new Date().toISOString(),
  }).eq("id", rhClientId);
  if (updateError) throw updateError;
  await refreshAuvoNameReferences(supabase, auvo.auvo_id, auvo.nome, target.nome_auvo);
  return { ok: true, mergedClientId: holder?.id ?? null };
}

async function refreshAuvoNameReferences(
  supabase: any,
  auvoCustomerId: number,
  currentName: string,
  previousName?: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { error: byIdError } = await supabase
    .from("equipamentos_auvo")
    .update({ cliente: currentName, atualizado_em: now })
    .eq("auvo_customer_id", auvoCustomerId);
  if (byIdError) throw byIdError;

  const oldName = String(previousName || "").trim();
  if (!oldName || normalize(oldName) === normalize(currentName)) return;

  // Compatibilidade para equipamentos sincronizados antes de existir o ID
  // estável do cliente.
  const { error: legacyEquipmentError } = await supabase
    .from("equipamentos_auvo")
    .update({ cliente: currentName, atualizado_em: now })
    .eq("cliente", oldName)
    .is("auvo_customer_id", null);
  if (legacyEquipmentError) throw legacyEquipmentError;

  // Os grupos controlam o gerador e o portal de preventivas. Migra o nome em
  // vez de criar um segundo cliente quando ele é renomeado no Auvo.
  const { data: memberships, error: membershipsError } = await supabase
    .from("grupo_cliente_membros")
    .select("grupo_id")
    .eq("cliente_nome", oldName);
  if (membershipsError) throw membershipsError;
  if (memberships?.length) {
    const { error: upsertError } = await supabase.from("grupo_cliente_membros").upsert(
      memberships.map((row: any) => ({ grupo_id: row.grupo_id, cliente_nome: currentName })),
      { onConflict: "grupo_id,cliente_nome", ignoreDuplicates: true },
    );
    if (upsertError) throw upsertError;
    const { error: deleteError } = await supabase
      .from("grupo_cliente_membros")
      .delete()
      .eq("cliente_nome", oldName);
    if (deleteError) throw deleteError;
  }

  const { error: autoGroupError } = await supabase
    .from("grupos_clientes")
    .update({ nome: `[Auto] ${currentName}` })
    .eq("nome", `[Auto] ${oldName}`);
  if (autoGroupError && autoGroupError.code !== "23505") throw autoGroupError;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    if (body?.action === "link") {
      const result = await handleManualLink(supabase, body);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!GC_ACCESS_TOKEN || !GC_SECRET_TOKEN) throw new Error("Credenciais do GestãoClick não configuradas");
    const autoCreateAuvo = body?.autoCreateAuvo !== false;
    const [gcCustomers, accessToken] = await Promise.all([fetchAllGcCustomers(), auvoLogin()]);
    const auvoCustomers = await fetchAllAuvoCustomers(accessToken);

    const { data: localRows, error: localError } = await supabase
      .from("rh_clientes")
      .select("id, nome, nome_auvo, nome_normalizado, gc_cliente_id, auvo_cliente_id, origem")
      .limit(10000);
    if (localError) throw localError;
    const locals = (localRows ?? []) as LocalCustomer[];

    const localByGcId = new Map(locals.filter((row) => row.gc_cliente_id).map((row) => [String(row.gc_cliente_id), row]));
    const localByAuvoId = new Map(locals.filter((row) => row.auvo_cliente_id).map((row) => [Number(row.auvo_cliente_id), row]));
    const localByName = new Map(locals.map((row) => [normalize(row.nome), row]));
    const auvoById = new Map(auvoCustomers.map((customer) => [customer.id, customer]));
    const auvoByExternalId = new Map(auvoCustomers.filter((customer) => customer.externalId).map((customer) => [String(customer.externalId).toUpperCase(), customer]));
    const auvoByDocument = new Map<string, AuvoCustomer[]>();
    const auvoByName = new Map<string, AuvoCustomer[]>();
    for (const customer of auvoCustomers) {
      addMulti(auvoByDocument, digits(customer.cpfCnpj), customer);
      addMulti(auvoByName, normalize(customer.name), customer);
      if (customer.legalName) addMulti(auvoByName, normalize(customer.legalName), customer);
    }

    // Atualiza o espelho completo do Auvo usado nas demais telas.
    const auvoCacheRows = auvoCustomers.map((customer) => ({
      auvo_id: customer.id,
      nome: customer.name,
      external_id: customer.externalId,
      cpf_cnpj: customer.cpfCnpj,
      nome_legal: customer.legalName,
      ativo: customer.active,
      endereco: customer.address,
      cidade: customer.city,
      estado: customer.state,
      cep: customer.zipCode,
      atualizado_em: new Date().toISOString(),
    }));
    for (let i = 0; i < auvoCacheRows.length; i += 500) {
      const { error } = await supabase.from("auvo_clientes_cache")
        .upsert(auvoCacheRows.slice(i, i + 500), { onConflict: "auvo_id" });
      if (error) throw error;
    }

    let linked = 0;
    let createdInAuvo = 0;
    let ambiguous = 0;
    let errors = 0;
    let inserted = 0;
    let updated = 0;
    const matchedAuvoIds = new Set<number>();
    const existingGcRows: any[] = [];
    const newGcRows: any[] = [];

    for (const gc of gcCustomers) {
      const gcId = String(gc?.id ?? gc?.codigo ?? "").trim();
      const name = gcName(gc);
      if (!gcId || !name) continue;
      const document = gcDocument(gc);
      const externalId = `GC:${gcId}`;
      let local = localByGcId.get(gcId) || localByName.get(normalize(name)) || null;

      let match: AuvoCustomer | null = null;
      let method = "";
      let confidence = 0;
      if (local?.auvo_cliente_id && auvoById.has(Number(local.auvo_cliente_id))) {
        match = auvoById.get(Number(local.auvo_cliente_id))!;
        method = "id_persistido";
        confidence = 1;
      } else if (auvoByExternalId.has(externalId.toUpperCase())) {
        match = auvoByExternalId.get(externalId.toUpperCase())!;
        method = "external_id_gc";
        confidence = 1;
      } else if (document && uniqueMatch(auvoByDocument, document)) {
        match = uniqueMatch(auvoByDocument, document);
        method = "cpf_cnpj";
        confidence = 0.98;
      } else if (uniqueMatch(auvoByName, normalize(name))) {
        match = uniqueMatch(auvoByName, normalize(name));
        method = "nome_exato_normalizado";
        confidence = 0.9;
      }

      let holderConflict = false;
      if (match) {
        const holder = localByAuvoId.get(match.id);
        if (!local && holder) local = holder;
        else if (local && holder && holder.id !== local.id) {
          match = null;
          method = "id_auvo_ja_vinculado_a_outro_cliente";
          confidence = 0;
          holderConflict = true;
        }
      }

      const documentCandidates = document ? auvoByDocument.get(document) ?? [] : [];
      const nameCandidates = auvoByName.get(normalize(name)) ?? [];
      const isAmbiguous = holderConflict || (!match && (documentCandidates.length > 1 || nameCandidates.length > 1));

      let syncError: string | null = null;
      if (!match && !isAmbiguous && autoCreateAuvo) {
        try {
          match = await upsertCustomerInAuvo(gc, accessToken);
          method = "criado_por_gc";
          confidence = 1;
          createdInAuvo++;
          auvoById.set(match.id, match);
          auvoByExternalId.set(externalId.toUpperCase(), match);
          const { error: cacheError } = await supabase.from("auvo_clientes_cache").upsert({
            auvo_id: match.id,
            nome: match.name,
            external_id: match.externalId,
            cpf_cnpj: match.cpfCnpj,
            nome_legal: match.legalName,
            ativo: match.active,
            endereco: match.address,
            cidade: match.city,
            estado: match.state,
            cep: match.zipCode,
            atualizado_em: new Date().toISOString(),
          }, { onConflict: "auvo_id" });
          if (cacheError) throw cacheError;
        } catch (error) {
          syncError = (error as Error).message;
          errors++;
        }
      }

      if (match) {
        matchedAuvoIds.add(match.id);
        linked++;
        if (local?.nome_auvo && normalize(local.nome_auvo) !== normalize(match.name)) {
          try {
            await refreshAuvoNameReferences(supabase, match.id, match.name, local.nome_auvo);
          } catch (error) {
            syncError = `Cliente vinculado, mas falhou ao propagar o nome do Auvo: ${(error as Error).message}`;
            errors++;
          }
        }
      } else if (isAmbiguous) {
        ambiguous++;
      }

      const patch = {
        ...gcPatch(gc),
        auvo_cliente_id: match?.id ?? null,
        nome_auvo: match?.name ?? null,
        auvo_external_id: match?.externalId ?? null,
        origem: match ? "gc_auvo" : "gc",
        vinculo_status: match ? "vinculado" : isAmbiguous ? "ambiguo" : syncError ? "erro" : "pendente",
        vinculo_metodo: method || (isAmbiguous ? "multiplos_candidatos" : null),
        vinculo_confianca: confidence || null,
        auvo_sync_em: match ? new Date().toISOString() : null,
        auvo_sync_erro: syncError,
        atualizado_em: new Date().toISOString(),
      };

      if (local) {
        existingGcRows.push({ id: local.id, ...patch });
      } else {
        newGcRows.push(patch);
      }
    }

    for (let i = 0; i < existingGcRows.length; i += 500) {
      const batch = existingGcRows.slice(i, i + 500);
      const { error } = await supabase.from("rh_clientes").upsert(batch, { onConflict: "id" });
      if (error) {
        errors += batch.length;
        console.error("[rh-clientes-sync] lote de atualização", error);
      } else updated += batch.length;
    }
    for (let i = 0; i < newGcRows.length; i += 500) {
      const batch = newGcRows.slice(i, i + 500);
      const { error } = await supabase.from("rh_clientes").upsert(batch, {
        onConflict: "gc_cliente_id",
        defaultToNull: false,
      });
      if (error) {
        errors += batch.length;
        console.error("[rh-clientes-sync] lote de inserção GC", error);
      } else inserted += batch.length;
    }

    // Clientes que existem apenas no Auvo também aparecem em RH > Clientes.
    let auvoOnly = 0;
    const existingAuvoOnlyRows: any[] = [];
    const newAuvoOnlyRows: any[] = [];
    for (const customer of auvoCustomers) {
      if (matchedAuvoIds.has(customer.id)) continue;
      const existing = localByAuvoId.get(customer.id);
      const row = {
        nome: customer.name,
        nome_auvo: customer.name,
        nome_normalizado: normalizeStored(customer.name),
        auvo_cliente_id: customer.id,
        auvo_external_id: customer.externalId,
        cpf_cnpj: customer.cpfCnpj,
        endereco: customer.address,
        cidade: customer.city,
        uf: customer.state,
        cep: customer.zipCode,
        ativo: customer.active,
        origem: "auvo",
        vinculo_status: "pendente",
        vinculo_metodo: "somente_auvo",
        vinculo_confianca: null,
        auvo_sync_em: new Date().toISOString(),
        auvo_sync_erro: null,
        atualizado_em: new Date().toISOString(),
      };
      if (existing) {
        existingAuvoOnlyRows.push({ id: existing.id, ...row });
        continue;
      }
      // Se o nome já pertence a uma linha GC não vinculada, ela fica ambígua em
      // vez de criar uma segunda linha com a mesma chave única.
      if (localByName.has(normalize(customer.name))) continue;
      newAuvoOnlyRows.push(row);
    }

    for (let i = 0; i < existingAuvoOnlyRows.length; i += 500) {
      const batch = existingAuvoOnlyRows.slice(i, i + 500);
      const { error } = await supabase.from("rh_clientes").upsert(batch, { onConflict: "id" });
      if (error) errors += batch.length;
      else auvoOnly += batch.length;
    }
    for (let i = 0; i < newAuvoOnlyRows.length; i += 500) {
      const batch = newAuvoOnlyRows.slice(i, i + 500);
      const { error } = await supabase.from("rh_clientes").upsert(batch, {
        onConflict: "auvo_cliente_id",
        defaultToNull: false,
      });
      if (error) errors += batch.length;
      else auvoOnly += batch.length;
    }

    return new Response(JSON.stringify({
      ok: errors === 0,
      gcTotal: gcCustomers.length,
      auvoTotal: auvoCustomers.length,
      linked,
      createdInAuvo,
      ambiguous,
      auvoOnly,
      inserted,
      updated,
      errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[rh-clientes-sync]", error);
    return new Response(
      JSON.stringify({ ok: false, error: (error as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
