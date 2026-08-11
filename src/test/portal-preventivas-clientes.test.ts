import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandPortalClientAliases,
  normalizePortalClientName,
  resolvePortalPreventiveGroupIds,
} from "@/lib/portalPreventivas";

const root = resolve(__dirname, "../..");
const portal = readFileSync(resolve(root, "src/pages/portal/PortalPlanosPreventivosPage.tsx"), "utf8");
const consolidator = readFileSync(resolve(root, "supabase/functions/preventiva-consolidar/index.ts"), "utf8");
const equipmentSync = readFileSync(resolve(root, "supabase/functions/equipment-sync/index.ts"), "utf8");

describe("portal do cliente e preventivas", () => {
  it("encontra o plano pela associação mesmo se o grupo automático estiver com nome antigo", () => {
    const allowed = resolvePortalPreventiveGroupIds({
      principalGroupId: "rede-klabin",
      principalMemberNames: ["SODEXO UNIDADE KLABIN RIO VERDE"],
      groups: [
        { id: "rede-klabin", nome: "KLABIN" },
        { id: "auto-antigo", nome: "[Auto] SODEXO DO BRASIL COMERCIAL S.A. KLABIN" },
        { id: "auto-outro", nome: "[Auto] OUTRO CLIENTE" },
      ],
      memberships: [
        { grupo_id: "auto-antigo", cliente_nome: "SODEXO UNIDADE KLABIN RIO VERDE LTDA" },
        { grupo_id: "auto-outro", cliente_nome: "OUTRO CLIENTE" },
      ],
    });

    expect(allowed).toEqual(new Set(["rede-klabin", "auto-antigo"]));
  });

  it("normaliza sufixos jurídicos sem misturar clientes diferentes", () => {
    expect(normalizePortalClientName("Sodexo Unidade Klabin Rio Verde Ltda."))
      .toBe(normalizePortalClientName("SODEXO UNIDADE KLABIN RIO VERDE"));
    expect(normalizePortalClientName("KLABIN RIO VERDE"))
      .not.toBe(normalizePortalClientName("KLABIN MONTE ALEGRE"));
  });

  it("usa o cadastro central para ligar o nome do GC ao nome atual do Auvo", () => {
    const aliases = expandPortalClientAliases(
      ["SODEXO DO BRASIL COMERCIAL S.A. KLABIN"],
      [{
        nome: "SODEXO DO BRASIL COMERCIAL S.A. KLABIN",
        nome_gc: "SODEXO DO BRASIL COMERCIAL S.A. KLABIN",
        nome_auvo: "SODEXO UNIDADE KLABIN RIO VERDE",
      }],
    );
    expect(aliases).toContain(normalizePortalClientName("SODEXO UNIDADE KLABIN RIO VERDE"));
  });

  it("consulta o consolidado pela chave interna correta e expõe histórico real", () => {
    expect(portal).toContain('.in("equip_id", slice)');
    expect(portal).not.toContain('.in("auvo_equipment_id", slice)');
    expect(portal).toContain('.from("plano_preventivo_execucao")');
    expect(portal).toContain("execucoesByItemId");
    expect(portal).toContain("Não foi possível carregar as preventivas");
  });

  it("reconstrói o histórico apenas com tarefas finalizadas dos dois tipos permitidos", () => {
    expect(consolidator).toContain('String(t.status_auvo || "").trim().toLowerCase() !== "finalizada"');
    expect(consolidator).toContain('.upsert(executionRows.slice(i, i + BATCH), { onConflict: "item_id,task_id" })');
    expect(consolidator).toContain('.eq("origem", "auto")');
    expect(equipmentSync).toContain("consolidar legado");
    expect(equipmentSync).toContain('(phase === "2" || phase === "all")');
  });
});
