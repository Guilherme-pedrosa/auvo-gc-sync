import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const sync = readFileSync(resolve(root, "supabase/functions/rh-clientes-sync-gc/index.ts"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260811130000_portal_preventivas_clientes_gc_auvo.sql"),
  "utf8",
);
const duplicateNamesMigration = readFileSync(
  resolve(root, "supabase/migrations/20260811143000_allow_duplicate_customer_names.sql"),
  "utf8",
);
const page = readFileSync(resolve(root, "src/pages/rh/ClientesRhPage.tsx"), "utf8");
const hook = readFileSync(resolve(root, "src/hooks/rh/useRh.ts"), "utf8");

describe("cadastro central RH > Clientes", () => {
  it("usa IDs como referência e aceita homônimos reais", () => {
    expect(duplicateNamesMigration).toContain("DROP CONSTRAINT IF EXISTS rh_clientes_nome_normalizado_key");
    expect(duplicateNamesMigration).toContain("idx_rh_clientes_nome_normalizado");
    expect(duplicateNamesMigration).toContain("DROP INDEX IF EXISTS public.uq_rh_clientes_auvo_cliente_id");
    expect(duplicateNamesMigration).toContain("UNIQUE (auvo_cliente_id)");
    expect(sync).toContain("upsertWithIsolation");
    expect(sync).toContain("mergeLocalCustomerDependencies");
    expect(sync).toContain("mergedDuplicates");
    expect(sync).toContain("errorSamples");
  });

  it("rejeita backend legado em vez de exibir contadores undefined", () => {
    expect(sync).toContain('RESPONSE_CONTRACT = "gc-auvo-v2"');
    expect(hook).toContain('data?.apiVersion !== "gc-auvo-v2"');
    expect(hook).toContain("Edge Function rh-clientes-sync-gc publicada está desatualizada");
    expect(hook).toContain('requiredMetrics = ["linked", "createdInAuvo", "ambiguous"]');
  });

  it("permite vincular pelo ID do Auvo sem depender do espelho", () => {
    expect(page).toContain("ID direto do cliente no Auvo");
    expect(sync).toContain("fetchAuvoCustomerById");
    expect(sync).toContain("/customers/${customerId}");
    expect(sync).toContain('upsert(cacheRow, { onConflict: "auvo_id" })');
  });

  it("prioriza IDs persistidos e documentos antes de considerar nome exato", () => {
    const byId = sync.indexOf('method = "id_persistido"');
    const byExternal = sync.indexOf('method = "external_id_gc"');
    const byDocument = sync.indexOf('method = "cpf_cnpj"');
    const byName = sync.indexOf('method = "nome_exato_normalizado"');
    expect(byId).toBeGreaterThan(0);
    expect(byId).toBeLessThan(byExternal);
    expect(byExternal).toBeLessThan(byDocument);
    expect(byDocument).toBeLessThan(byName);
  });

  it("cria automaticamente no Auvo com chave idempotente do GestãoClick", () => {
    expect(sync).toContain('method: "PUT"');
    expect(sync).toContain('externalId: `GC:${gcId}`');
    expect(sync).toContain("autoCreateAuvo");
    expect(sync).toContain("!match && !isAmbiguous && autoCreateAuvo");
  });

  it("propaga renomeação do Auvo sem depender do cache textual", () => {
    expect(sync).toContain("refreshAuvoNameReferences");
    expect(sync).toContain('.eq("auvo_customer_id", auvoCustomerId)');
    expect(sync).toContain('.from("grupo_cliente_membros")');
  });

  it("centraliza operação, auditoria e vínculo manual em RH > Clientes", () => {
    expect(page).toContain("Sincronizar GC + Auvo");
    expect(page).toContain("Vinculados GC ↔ Auvo");
    expect(page).toContain("Vínculo com o Auvo");
    expect(page).toContain("useLinkRhClienteAuvo");
  });

  it("instala IDs estáveis e o job incremental no banco", () => {
    expect(migration).toContain("auvo_cliente_id BIGINT");
    expect(migration).toContain("auvo_customer_id BIGINT");
    expect(migration).toContain("sync-clientes-gc-auvo-10min");
    expect(migration).toContain("*/10 * * * *");
    expect(migration).toContain("'mode', 'incremental'");
    expect(sync).toContain('ordenacao: "id", direcao: "desc"');
    expect(sync).toContain('syncMode === "incremental" && gcCustomers.length === 0');
    expect(migration).toContain("sync-auvo-customers-daily");
  });
});
