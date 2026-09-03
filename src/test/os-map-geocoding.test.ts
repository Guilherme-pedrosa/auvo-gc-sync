import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const mapView = readFileSync(resolve(root, "src/components/financeiro/OSMapView.tsx"), "utf8");
const googleMaps = readFileSync(resolve(root, "supabase/functions/google-maps/index.ts"), "utf8");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20260903103000_os_map_geocoding_cache.sql"),
  "utf8",
);

describe("geocodificação e operação do mapa de OS", () => {
  it("deduplica endereços antes de chamar o Google e mantém o resultado por OS", () => {
    expect(mapView).toContain("groupedByAddress");
    expect(mapView).toContain("uniqueGroups");
    expect(mapView).toContain("for (const item of group)");
  });

  it("distingue falta de endereço de falha do provedor", () => {
    expect(mapView).toContain("missingAddressItems");
    expect(mapView).toContain("geocodeFailures");
    expect(mapView).toContain('type SidebarMode = "mapped" | "missing" | "failed"');
  });

  it("instala e usa cache persistente sem depender de chamadas ao GestãoClick", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.os_map_geocoding_cache");
    expect(migration).toContain("PRIMARY KEY");
    expect(googleMaps).toContain('.from("os_map_geocoding_cache")');
    expect(googleMaps).toContain("cacheIsFresh");
    expect(googleMaps).toContain("requestedFromGoogle");
  });

  it("exige seleção operacional para montar rota e limita a URL externa", () => {
    expect(mapView).toContain("selectedRouteIds");
    expect(mapView).toContain("routeItems.slice(0, 10)");
    expect(mapView).toContain("Selecione pelo menos 2 paradas");
  });
});
