import { describe, expect, it } from "vitest";
import {
  cacheTtlSeconds,
  GC_BROKER_DAILY_CAP,
  GC_BROKER_WRITE_RESERVE,
  normalizeGcEndpoint,
  normalizeSource,
  protectWritePayload,
} from "../../supabase/functions/_shared/gc-broker-core";

describe("broker global do GestãoClick", () => {
  it("mantém margem antes do limite empresarial e reserva gravações", () => {
    expect(GC_BROKER_DAILY_CAP).toBe(27_000);
    expect(GC_BROKER_WRITE_RESERVE).toBe(3_000);
  });

  it("aceita somente endpoints oficiais e normaliza a chave", () => {
    const url = normalizeGcEndpoint("/api/produtos?pagina=2&usuario_id=999&limite=100", {
      busca: "motor",
    });
    expect(url.origin).toBe("https://api.gestaoclick.com");
    expect(url.searchParams.has("usuario_id")).toBe(false);
    expect(url.search).toBe("?busca=motor&limite=100&pagina=2");
    expect(() => normalizeGcEndpoint("https://example.com/api/produtos")).toThrow(/fora/);
  });

  it("sobrescreve o usuário de qualquer gravação", () => {
    expect(protectWritePayload({ nome: "Teste", usuario_id: "999" }, "1320473"))
      .toEqual({ nome: "Teste", usuario_id: "1320473" });
  });

  it("usa cache maior em cadastros e curto em dados transacionais", () => {
    expect(cacheTtlSeconds(normalizeGcEndpoint("/api/situacoes"))).toBe(3_600);
    expect(cacheTtlSeconds(normalizeGcEndpoint("/api/produtos"))).toBe(300);
    expect(cacheTtlSeconds(normalizeGcEndpoint("/api/vendas"))).toBe(30);
    expect(cacheTtlSeconds(normalizeGcEndpoint("/api/vendas"), 9_999)).toBe(3_600);
  });

  it("normaliza a origem usada na telemetria", () => {
    expect(normalizeSource(" WeDo ML / Produção ")).toBe("wedo-ml-produ-o");
  });
});
