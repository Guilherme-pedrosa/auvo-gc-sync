import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const sync = readFileSync(resolve(root, "supabase/functions/rh-clientes-sync-gc/index.ts"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260811130000_portal_preventivas_clientes_gc_auvo.sql"),
  "utf8",
);
const page = readFileSync(resolve(root, "src/pages/rh/ClientesRhPage.tsx"), "utf8");

describe("cadastro central RH > Clientes", () => {
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
