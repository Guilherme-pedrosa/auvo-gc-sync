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
const RESPONSE_CONTRACT = "gc-auvo-v2";

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

async function gcPage(
  page: number,
  params: Record<string, string> = {},
): Promise<{ rows: any[]; hasNext: boolean }> {
  const url = new URL(`${GC_BASE}/clientes`);
  url.searchParams.set("pagina", String(page));
  url.searchParams.set("limite", "100");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const headers = { ...gcHeaders, "usuario-id": "1320473" };
  const response = await fetch(url.toString(), { headers });
  const raw = await response.text();
  if (response.status === 404) return { rows: [], hasNext: false };
  if (!response.ok) throw new Error(`GestãoClick /clientes página ${page} respondeu ${response.status}: ${raw.slice(0, 300)}`);
  const json = raw ? JSON.parse(raw) : {};
  const rows = Array.isArray(json?.data) ? json.data : [];
  return { rows, hasNext: Boolean(json?.meta?.proxima_pagina) && rows.length > 0 };
}

async function fetchNewGcCustomers(knownIds: Set<string>): Promise<any[]> {
  if (knownIds.size === 0) return fetchAllGcCustomers();

  const newCustomers: any[] = [];
  // IDs do GC são crescentes. Ordenando do mais novo para o mais antigo, a
  // varredura automática normalmente consome uma única requisição e para ao
  // encontrar o primeiro cliente que já existe no cadastro central.
  for (let page = 1; page <= 50; page++) {
    const result = await gcPage(page, { ordenacao: "id", direcao: "desc" });
    let reachedKnownCustomer = false;
    for (const customer of result.rows) {
      const id = String(customer?.id ?? customer?.codigo ?? "").trim();
      if (id && knownIds.has(id)) {
        reachedKnownCustomer = true;
        break;
      }
      if (id) newCustomers.push(customer);
    }
    if (reachedKnownCustomer || !result.hasNext) break;
    // Pequeno intervalo para respeitar limite de 3req/s do GC
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return newCustomers;
}

async function fetchAllGcCustomers(): Promise<any[]> {
  const all: any[] = [];
  // GestãoClick limita a 3 chamadas/s. Três páginas por bloco respeitam o limite.
  for (let firstPage = 1; firstPage <= 300; firstPage += 3) {
    const pages = [firstPage, firstPage + 1, firstPage + 2];
    const results = await Promise.all(pages.map(gcPage));
    for (const result of results) all.push(...result.rows);
    if (!results.some((result) => result.hasNext)) break;
    // Intervalo ligeiramente maior para garantir conformidade com o limite de taxa do GC
    await new Promise((resolve) => setTimeout(resolve, 1100));
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

async function fetchAuvoCustomerById(customerId: number): Promise<AuvoCustomer> {
  const accessToken = await auvoLogin();
  const response = await fetch(`${AUVO_BASE}/customers/${customerId}`, {
    headers: auvoHeaders(accessToken),
  });
  const raw = await response.text();
  const json = raw ? JSON.parse(raw) : {};
  if (!response.ok) {
    throw new Error(`Cliente Auvo #${customerId} não encontrado (${response.status})`);
  }
  const mapped = mapAuvoCustomer(json?.result ?? json);
  if (!mapped || mapped.id !== customerId) {
    throw new Error(`Auvo não devolveu os dados do cliente #${customerId}`);
  }
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

type SafeUpsertResult = { saved: number; errors: number; errorSamples: string[] };

async function upsertWithIsolation(
  supabase: any,
  table: string,
  rows: any[],
  options: Record<string, unknown>,
  context: string,
): Promise<SafeUpsertResult> {
  if (rows.length === 0) return { saved: 0, errors: 0, errorSamples: [] };

  const { error } = await supabase.from(table).upsert(rows, options);
  if (!error) return { saved: rows.length, errors: 0, errorSamples: [] };

  // Um conflito isolado não pode invalidar centenas de clientes do mesmo lote.
  // Divide o lote até identificar somente as linhas realmente problemáticas.
  if (rows.length > 1) {
    const middle = Math.ceil(rows.length / 2);
    const [left, right] = await Promise.all([
      upsertWithIsolation(supabase, table, rows.slice(0, middle), options, context),
      upsertWithIsolation(supabase, table, rows.slice(middle), options, context),
    ]);
    return {
      saved: left.saved + right.saved,
      errors: left.errors + right.errors,
      errorSamples: [...left.errorSamples, ...right.errorSamples].slice(0, 10),
    };
  }

  const rowId = String(rows[0]?.auvo_cliente_id ?? rows[0]?.gc_cliente_id ?? rows[0]?.id ?? "sem-id");
  const detail = `${context} ${rowId}: ${error.message}`;
  console.error(`[rh-clientes-sync] ${detail}`);
  return { saved: 0, errors: 1, errorSamples: [detail] };
}

async function mergeLocalCustomerDependencies(
  supabase: any,
  targetId: string,
  holderId: string,
): Promise<void> {
  const { data: requirements, error: reqError } = await supabase
    .from("rh_client_requirements")
    .select("document_type_id, required_for, is_required, observacoes")
    .eq("client_id", holderId);
  if (reqError) throw reqError;
  if (requirements?.length) {
    const { error } = await supabase.from("rh_client_requirements").upsert(
      requirements.map((row: any) => ({ ...row, client_id: targetId })),
      { onConflict: "client_id,document_type_id,required_for" },
    );
    if (error) throw error;
  }

  const { error: integrationsError } = await supabase
    .from("rh_integrations")
    .update({ client_id: targetId })
    .eq("client_id", holderId);
  if (integrationsError) throw integrationsError;

  const { data: sharedLinks, error: sharedError } = await supabase
    .from("rh_integration_clients")
    .select("integration_id")
    .eq("client_id", holderId);
  if (sharedError) throw sharedError;
  if (sharedLinks?.length) {
    const { error } = await supabase.from("rh_integration_clients").upsert(
      sharedLinks.map((row: any) => ({ integration_id: row.integration_id, client_id: targetId })),
      { onConflict: "integration_id,client_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  const { error: deleteError } = await supabase.from("rh_clientes").delete().eq("id", holderId);
  if (deleteError) throw deleteError;
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

  const { data: cachedAuvo, error: auvoError } = await supabase
    .from("auvo_clientes_cache")
    .select("auvo_id, nome, external_id")
    .eq("auvo_id", auvoCustomerId)
    .maybeSingle();
  if (auvoError) throw auvoError;
  let auvo = cachedAuvo;
  if (!auvo) {
    // Aceita o ID direto mesmo se o espelho estiver vazio ou desatualizado.
    // O vínculo só é salvo depois de confirmar o cliente na API do Auvo.
    const fetched = await fetchAuvoCustomerById(auvoCustomerId);
    const cacheRow = {
      auvo_id: fetched.id,
      nome: fetched.name,
      external_id: fetched.externalId,
      cpf_cnpj: fetched.cpfCnpj,
      nome_legal: fetched.legalName,
      ativo: fetched.active,
      endereco: fetched.address,
      cidade: fetched.city,
      estado: fetched.state,
      cep: fetched.zipCode,
      atualizado_em: new Date().toISOString(),
    };
    const { error: cacheError } = await supabase
      .from("auvo_clientes_cache")
      .upsert(cacheRow, { onConflict: "auvo_id" });
    if (cacheError) throw cacheError;
    auvo = { auvo_id: fetched.id, nome: fetched.name, external_id: fetched.externalId };
  }

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
    await mergeLocalCustomerDependencies(supabase, rhClientId, holder.id);
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

async function fetchAuvoCustomersLight(accessToken: string): Promise<AuvoCustomer[]> {
  const all: AuvoCustomer[] = [];
  const filter = encodeURIComponent(JSON.stringify({}));
  const fields = encodeURIComponent("id,externalId,description,name,legalName,cpfCnpj,active");
  for (let page = 1; page <= 200; page++) {
    const response = await fetch(
      `${AUVO_BASE}/customers/?paramFilter=${filter}&page=${page}&pageSize=500&order=asc&selectfields=${fields}`,
      { headers: auvoHeaders(accessToken) },
    );
    if (response.status === 404) break;
    const raw = await response.text();
    if (!response.ok) throw new Error(`Auvo /customers página ${page} respondeu ${response.status}: ${raw.slice(0, 200)}`);
    const json = raw ? JSON.parse(raw) : {};
    const list = json?.result?.entityList ?? json?.result ?? [];
    if (!Array.isArray(list) || list.length === 0) break;
    for (const item of list) {
      const mapped = mapAuvoCustomer(item);
      if (mapped) all.push(mapped);
    }
    if (list.length < 500) break;
  }
  return all;
}

function namesLookCompatible(a: string, b: string): boolean {
  const tokensA = new Set(normalize(a).split(" ").filter((t) => t.length >= 3));
  const tokensB = new Set(normalize(b).split(" ").filter((t) => t.length >= 3));
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  for (const token of tokensA) if (tokensB.has(token)) return true;
  return false;
}

async function handleDocumentLookup(supabase: any, body: any): Promise<Record<string, unknown>> {
  const ids = Array.isArray(body?.rhClientIds)
    ? body.rhClientIds.map((value: unknown) => String(value || "").trim()).filter(Boolean)
    : [];
  if (ids.length === 0) throw new Error("Nenhum cliente selecionado");
  if (ids.length > 200) throw new Error("Selecione no máximo 200 clientes por consulta");

  const { data: rows, error } = await supabase
    .from("rh_clientes")
    .select("id, nome, cpf_cnpj, auvo_cliente_id")
    .in("id", ids);
  if (error) throw error;

  const accessToken = await auvoLogin();
  const auvoCustomers = await fetchAuvoCustomersLight(accessToken);
  const auvoByDocument = new Map<string, AuvoCustomer[]>();
  for (const customer of auvoCustomers) addMulti(auvoByDocument, digits(customer.cpfCnpj), customer);

  const wanted = new Set(
    (rows ?? []).map((row: any) => digits(row.cpf_cnpj)).filter((doc: string) => doc.length === 11 || doc.length === 14),
  );
  const cacheRows = auvoCustomers
    .filter((customer) => wanted.has(digits(customer.cpfCnpj)))
    .map((customer) => ({
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
  for (let i = 0; i < cacheRows.length; i += 500) {
    const { error: cacheError } = await supabase
      .from("auvo_clientes_cache")
      .upsert(cacheRows.slice(i, i + 500), { onConflict: "auvo_id" });
    if (cacheError) throw cacheError;
  }

  let linked = 0, alreadyLinked = 0, ambiguous = 0, notFound = 0, invalidDocument = 0, errors = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const row of rows ?? []) {
    const document = digits(row.cpf_cnpj);
    if (row.auvo_cliente_id) {
      alreadyLinked++;
      details.push({ id: row.id, nome: row.nome, resultado: "ja_vinculado" });
      continue;
    }
    if (document.length !== 11 && document.length !== 14) {
      invalidDocument++;
      details.push({ id: row.id, nome: row.nome, resultado: "sem_documento" });
      continue;
    }
    const candidates = auvoByDocument.get(document) ?? [];
    if (candidates.length === 0) {
      notFound++;
      details.push({ id: row.id, nome: row.nome, resultado: "nao_encontrado" });
      continue;
    }
    if (candidates.length > 1) {
      ambiguous++;
      await supabase.from("rh_clientes").update({
        vinculo_status: "ambiguo",
        vinculo_metodo: "cpf_cnpj",
        vinculo_confianca: 0.4,
        auvo_sync_erro: `CPF/CNPJ encontrado em ${candidates.length} cadastros do Auvo: ${candidates
          .map((c) => `#${c.id} (${c.name})`)
          .join(" | ")}`,
        atualizado_em: new Date().toISOString(),
      }).eq("id", row.id);
      details.push({
        id: row.id,
        nome: row.nome,
        resultado: "ambiguo",
        candidatos: candidates.map((c) => ({ auvoId: c.id, nome: c.name })),
      });
      continue;
    }
    const candidate = candidates[0];
    if (!namesLookCompatible(row.nome, candidate.name) && !namesLookCompatible(row.nome, candidate.legalName || "")) {
      ambiguous++;
      await supabase.from("rh_clientes").update({
        vinculo_status: "ambiguo",
        vinculo_metodo: "cpf_cnpj_nome_divergente",
        vinculo_confianca: 0.4,
        auvo_sync_erro: `CPF/CNPJ igual ao Auvo #${candidate.id} (${candidate.name}), mas o nome diverge`,
        atualizado_em: new Date().toISOString(),
      }).eq("id", row.id);
      details.push({
        id: row.id,
        nome: row.nome,
        resultado: "nome_divergente",
        candidatos: [{ auvoId: candidate.id, nome: candidate.name }],
      });
      continue;
    }
    try {
      await handleManualLink(supabase, { rhClientId: row.id, auvoCustomerId: candidate.id });
      linked++;
      details.push({ id: row.id, nome: row.nome, resultado: "vinculado", auvoId: candidate.id, auvoNome: candidate.name });
    } catch (linkError) {
      errors++;
      details.push({ id: row.id, nome: row.nome, resultado: "erro", mensagem: String((linkError as Error)?.message || linkError) });
    }
  }

  return {
    ok: true,
    checked: (rows ?? []).length,
    auvoTotal: auvoCustomers.length,
    linked,
    alreadyLinked,
    ambiguous,
    notFound,
    invalidDocument,
    errors,
    details,
  };
}

async function handleUpdateAuvoName(supabase: any, body: any): Promise<Record<string, unknown>> {
  const rhClientId = String(body?.rhClientId || "").trim();
  const newName = String(body?.newName || "").trim();
  if (!rhClientId) throw new Error("Cliente central não informado");
  if (!newName) throw new Error("Novo nome não informado");

  const { data: target, error: targetError } = await supabase
    .from("rh_clientes")
    .select("id, auvo_cliente_id, nome_auvo")
    .eq("id", rhClientId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) throw new Error("Cliente central não encontrado");
  if (!target.auvo_cliente_id) throw new Error("Cliente não possui vínculo com o Auvo");

  const accessToken = await auvoLogin();
  
  // GET completo para preservar outros campos (Estratégia da memória)
  const response = await fetch(`${AUVO_BASE}/customers/${target.auvo_cliente_id}`, {
    headers: auvoHeaders(accessToken),
  });
  if (!response.ok) throw new Error(`Falha ao buscar cliente no Auvo (#${target.auvo_cliente_id})`);
  const rawData = await response.json();
  const currentAuvo = rawData?.result ?? rawData;

  // Merge & PUT
  // O Auvo v2 espera um payload com campos específicos no PUT
  const payload = {
    id: currentAuvo.id,
    externalId: currentAuvo.externalId,
    name: newName,
    legalName: currentAuvo.legalName,
    cpfCnpj: currentAuvo.cpfCnpj,
    phoneNumber: currentAuvo.phoneNumber || [],
    email: currentAuvo.email || [],
    address: currentAuvo.address,
    city: currentAuvo.city,
    state: currentAuvo.state,
    zipCode: currentAuvo.zipCode,
    active: currentAuvo.active,
    replaceData: false,
    identifierBycpfCnpj: false
  };
  
  const putResponse = await fetch(`${AUVO_BASE}/customers/`, {
    method: "PUT",
    headers: auvoHeaders(accessToken),
    body: JSON.stringify(payload),
  });

  const putRaw = await putResponse.text();
  if (!putResponse.ok) throw new Error(`Erro ao atualizar no Auvo: ${putRaw}`);

  // Atualiza localmente
  const { error: updateError } = await supabase.from("rh_clientes").update({
    nome_auvo: newName,
    auvo_sync_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  }).eq("id", rhClientId);
  if (updateError) throw updateError;

  // Propaga para equipamentos e grupos
  await refreshAuvoNameReferences(supabase, target.auvo_cliente_id, newName, target.nome_auvo);

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    if (body?.action === "link") {
      const result = await handleManualLink(supabase, body);
      return new Response(JSON.stringify({ ...result, apiVersion: RESPONSE_CONTRACT }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body?.action === "lookup_document") {
      const result = await handleDocumentLookup(supabase, body);
      return new Response(JSON.stringify({ ...result, apiVersion: RESPONSE_CONTRACT }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body?.action === "update_auvo_name") {
      const result = await handleUpdateAuvoName(supabase, body);
      return new Response(JSON.stringify({ ...result, apiVersion: RESPONSE_CONTRACT }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!GC_ACCESS_TOKEN || !GC_SECRET_TOKEN) throw new Error("Credenciais do GestãoClick não configuradas");
    const autoCreateAuvo = body?.autoCreateAuvo !== false;
    const syncMode = body?.mode === "incremental" ? "incremental" : "full";

    const { data: localRows, error: localError } = await supabase
      .from("rh_clientes")
      .select("id, nome, nome_auvo, nome_normalizado, gc_cliente_id, auvo_cliente_id, origem")
      .limit(10000);
    if (localError) throw localError;
    const locals = (localRows ?? []) as LocalCustomer[];
    const knownGcIds = new Set(
      locals.map((row) => String(row.gc_cliente_id || "").trim()).filter(Boolean),
    );
    const gcCustomers = syncMode === "incremental"
      ? await fetchNewGcCustomers(knownGcIds)
      : await fetchAllGcCustomers();

    // O polling de dez minutos existe só para descobrir novos cadastros do GC.
    // Se não há novidade, não varre o Auvo nem regrava mil clientes.
    if (syncMode === "incremental" && gcCustomers.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        apiVersion: RESPONSE_CONTRACT,
        mode: syncMode,
        gcTotal: 0,
        auvoTotal: 0,
        linked: 0,
        createdInAuvo: 0,
        ambiguous: 0,
        auvoOnly: 0,
        inserted: 0,
        updated: 0,
        errors: 0,
        syncTime: new Date().toISOString()
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await auvoLogin();
    const auvoCustomers = await fetchAllAuvoCustomers(accessToken);

    const localByGcId = new Map(locals.filter((row) => row.gc_cliente_id).map((row) => [String(row.gc_cliente_id), row]));
    const localByAuvoId = new Map(locals.filter((row) => row.auvo_cliente_id).map((row) => [Number(row.auvo_cliente_id), row]));
    const localByName = new Map<string, LocalCustomer[]>();
    for (const row of locals) {
      const key = normalize(row.nome);
      const bucket = localByName.get(key) ?? [];
      bucket.push(row);
      localByName.set(key, bucket);
    }
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
    const errorSamples: string[] = [];
    let inserted = 0;
    let updated = 0;
    let mergedDuplicates = 0;
    // No modo incremental os clientes antigos do GC não entram em gcCustomers,
    // mas seus vínculos continuam válidos e não podem virar "somente Auvo".
    const matchedAuvoIds = new Set<number>(
      locals
        .filter((row) => row.gc_cliente_id && row.auvo_cliente_id)
        .map((row) => Number(row.auvo_cliente_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    );
    const existingGcRows: any[] = [];
    const newGcRows: any[] = [];

    for (const gc of gcCustomers) {
      const gcId = String(gc?.id ?? gc?.codigo ?? "").trim();
      const name = gcName(gc);
      if (!gcId || !name) continue;
      const document = gcDocument(gc);
      const externalId = `GC:${gcId}`;
      const localNameCandidates = localByName.get(normalize(name)) ?? [];
      let local = localByGcId.get(gcId) || (localNameCandidates.length === 1 ? localNameCandidates[0] : null);

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

      let syncError: string | null = null;
      let holderConflict = false;
      if (match) {
        const holder = localByAuvoId.get(match.id);
        if (!local && holder) local = holder;
        else if (local && holder && holder.id !== local.id) {
          if (!holder.gc_cliente_id) {
            try {
              await mergeLocalCustomerDependencies(supabase, local.id, holder.id);
              localByAuvoId.set(match.id, local);
              mergedDuplicates++;
            } catch (error) {
              syncError = `Falha ao unir cadastro Auvo duplicado: ${(error as Error).message}`;
              match = null;
              method = "falha_uniao_cadastro_auvo";
              confidence = 0;
              holderConflict = true;
              errors++;
              if (errorSamples.length < 10) errorSamples.push(`GC ${gcId}: ${syncError}`);
            }
          } else {
            match = null;
            method = "id_auvo_vinculado_a_outro_gc";
            confidence = 0;
            holderConflict = true;
          }
        }
      }

      const documentCandidates = document ? auvoByDocument.get(document) ?? [] : [];
      const nameCandidates = auvoByName.get(normalize(name)) ?? [];
      const isAmbiguous = holderConflict || (!match && (documentCandidates.length > 1 || nameCandidates.length > 1));

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
          if (errorSamples.length < 10) errorSamples.push(`GC ${gcId}: ${syncError}`);
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
      const result = await upsertWithIsolation(
        supabase,
        "rh_clientes",
        batch,
        { onConflict: "id" },
        "atualização GC",
      );
      updated += result.saved;
      errors += result.errors;
      errorSamples.push(...result.errorSamples.slice(0, Math.max(0, 10 - errorSamples.length)));
    }
    for (let i = 0; i < newGcRows.length; i += 500) {
      const batch = newGcRows.slice(i, i + 500);
      const result = await upsertWithIsolation(
        supabase,
        "rh_clientes",
        batch,
        { onConflict: "gc_cliente_id", defaultToNull: false },
        "inserção GC",
      );
      inserted += result.saved;
      errors += result.errors;
      errorSamples.push(...result.errorSamples.slice(0, Math.max(0, 10 - errorSamples.length)));
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
      const result = await upsertWithIsolation(
        supabase,
        "rh_clientes",
        batch,
        { onConflict: "id" },
        "atualização Auvo",
      );
      auvoOnly += result.saved;
      errors += result.errors;
      errorSamples.push(...result.errorSamples.slice(0, Math.max(0, 10 - errorSamples.length)));
    }
    for (let i = 0; i < newAuvoOnlyRows.length; i += 500) {
      const batch = newAuvoOnlyRows.slice(i, i + 500);
      const result = await upsertWithIsolation(
        supabase,
        "rh_clientes",
        batch,
        { onConflict: "auvo_cliente_id", defaultToNull: false },
        "inserção Auvo",
      );
      auvoOnly += result.saved;
      errors += result.errors;
      errorSamples.push(...result.errorSamples.slice(0, Math.max(0, 10 - errorSamples.length)));
    }

    return new Response(JSON.stringify({
      ok: errors === 0,
      apiVersion: RESPONSE_CONTRACT,
      mode: syncMode,
      gcTotal: gcCustomers.length,
      auvoTotal: auvoCustomers.length,
      linked,
      createdInAuvo,
      ambiguous,
      auvoOnly,
      inserted,
      updated,
      mergedDuplicates,
      errors,
      errorSamples,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[rh-clientes-sync]", error);
    return new Response(
      JSON.stringify({ ok: false, apiVersion: RESPONSE_CONTRACT, error: (error as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
