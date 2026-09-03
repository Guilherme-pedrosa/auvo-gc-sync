/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  InfoWindow,
  Polyline,
} from "@react-google-maps/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ListChecks,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Search,
} from "lucide-react";
import { toast } from "sonner";

type OSItem = {
  mirror_key?: string;
  auvo_task_id: string;
  cliente: string;
  tecnico: string;
  tecnico_id: string | null;
  data_tarefa: string;
  status_auvo: string;
  endereco: string | null;
  gc_os_codigo: string;
  gc_os_valor_total: number;
  gc_os_link: string | null;
  gc_os_situacao?: string | null;
  map_address_source?: "tarefa_auvo" | "rh_clientes" | "ausente";
  map_address_issue?: string | null;
  map_client_id?: string | null;
  [key: string]: any;
};

type GeocodedItem = OSItem & {
  lat: number;
  lng: number;
  formatted_address: string;
};

type RouteResult = {
  polyline: string | null;
  waypoint_order: number[];
  total_distance_km: number;
  total_duration_min: number;
  legs: { distance: string; duration: string; start_address: string; end_address: string }[];
};

type GeocodeFailure = {
  item: OSItem;
  reason: string;
  providerStatus?: string | null;
};

type SidebarMode = "mapped" | "missing" | "failed";

interface CorridorRoute {
  encodedPolyline: string;
  originCoord: { lat: number; lng: number };
  destCoord: { lat: number; lng: number };
  originLabel: string;
  destLabel: string;
}

interface OSMapViewProps {
  items: OSItem[];
  cityColorMap: globalThis.Map<string, { bg: string; text: string }>;
  cityMap: globalThis.Map<string, string>;
  formatCurrency: (val: number) => string;
  onSelectCard: (item: OSItem) => void;
  autoOptimize?: boolean;
  corridorRoute?: CorridorRoute | null;
}

const mapContainerStyle = { width: "100%", height: "100%" };
const defaultCenter = { lat: -15.7942, lng: -47.8822 };
const LIBRARIES: ("geometry" | "places")[] = ["geometry"];

function itemKey(item: OSItem): string {
  return item.mirror_key || `${item.auvo_task_id}::${item.gc_os_id || item.gc_os_codigo || ""}`;
}

function addressKey(address: string): string {
  return address
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Singleton API key cache
let cachedApiKey: string | null = null;
let keyPromise: Promise<string> | null = null;

async function fetchApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const { data, error } = await supabase.functions.invoke("google-maps", {
      body: { action: "api_key" },
    });
    if (error || !data?.key) throw new Error("Erro ao carregar API Key do Google Maps");
    cachedApiKey = data.key;
    return data.key;
  })();
  return keyPromise;
}

export default function OSMapView({ items, cityColorMap, cityMap, formatCurrency, onSelectCard, autoOptimize, corridorRoute }: OSMapViewProps) {
  const [apiKey, setApiKey] = useState<string | null>(cachedApiKey);
  const [loadingKey, setLoadingKey] = useState(!cachedApiKey);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedApiKey) { setApiKey(cachedApiKey); setLoadingKey(false); return; }
    fetchApiKey()
      .then((key) => { setApiKey(key); setLoadingKey(false); })
      .catch((err) => { setKeyError(err.message); setLoadingKey(false); });
  }, []);

  if (loadingKey) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando mapa...
      </div>
    );
  }

  if (keyError || !apiKey) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">
        <p className="text-sm">{keyError || "Chave do Google Maps não disponível"}</p>
      </div>
    );
  }

  return (
    <OSMapViewInner
      apiKey={apiKey}
      items={items}
      cityColorMap={cityColorMap}
      cityMap={cityMap}
      formatCurrency={formatCurrency}
      onSelectCard={onSelectCard}
      autoOptimize={autoOptimize}
      corridorRoute={corridorRoute}
    />
  );
}

function OSMapViewInner({
  apiKey,
  items,
  cityColorMap,
  cityMap,
  formatCurrency,
  onSelectCard,
  autoOptimize,
  corridorRoute,
}: OSMapViewProps & { apiKey: string }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    language: "pt-BR",
    libraries: LIBRARIES,
  });

  const mapRef = useRef<google.maps.Map | null>(null);

  const [geocoding, setGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({ done: 0, total: 0 });
  const [geocodedItems, setGeocodedItems] = useState<GeocodedItem[]>([]);
  const [geocodeFailures, setGeocodeFailures] = useState<GeocodeFailure[]>([]);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routePath, setRoutePath] = useState<google.maps.LatLngLiteral[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<GeocodedItem | null>(null);
  const [selectedRouteIds, setSelectedRouteIds] = useState<Set<string>>(new Set());
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("mapped");
  const [listSearch, setListSearch] = useState("");
  const geocodeRunRef = useRef(0);
  const geocodedSignatureRef = useRef("");

  const missingAddressItems = useMemo(
    () => items.filter((item) => !item.endereco || item.endereco.trim().length <= 5),
    [items],
  );

  const itemsSignature = useMemo(
    () => items
      .map((item) => `${itemKey(item)}:${addressKey(item.endereco || "")}`)
      .sort()
      .join("|"),
    [items],
  );

  const corridorPath = useMemo(() => {
    if (!isLoaded || !corridorRoute?.encodedPolyline) return [];
    try {
      const decodedPath = google.maps.geometry.encoding.decodePath(corridorRoute.encodedPolyline);
      return decodedPath.map((p: google.maps.LatLng) => ({ lat: p.lat(), lng: p.lng() }));
    } catch (error) {
      console.error("Erro ao decodificar rota do corredor:", error);
      return [];
    }
  }, [isLoaded, corridorRoute?.encodedPolyline]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // Geocodifica endereços únicos: várias OS do mesmo cliente consomem uma só
  // consulta e depois recebem o mesmo ponto. O cache persistente fica na Edge.
  const geocodeItems = useCallback(async (forceRefresh = false) => {
    const addressable = items.filter((i) => i.endereco && i.endereco.length > 5);
    if (addressable.length === 0) {
      geocodedSignatureRef.current = itemsSignature;
      setGeocodedItems([]);
      setGeocodeFailures([]);
      setSelectedRouteIds(new Set());
      return;
    }

    const runId = ++geocodeRunRef.current;
    geocodedSignatureRef.current = itemsSignature;
    setGeocoding(true);
    setGeocodedItems([]);
    setGeocodeFailures([]);
    setSelectedMarker(null);
    setSelectedRouteIds(new Set());
    setGeocodeProgress({ done: 0, total: new Set(addressable.map((item) => addressKey(item.endereco!))).size });
    setRouteResult(null);
    setRoutePath([]);
    try {
      const groupedByAddress = new Map<string, OSItem[]>();
      for (const item of addressable) {
        const key = addressKey(item.endereco!);
        const group = groupedByAddress.get(key) || [];
        group.push(item);
        groupedByAddress.set(key, group);
      }

      const uniqueGroups = [...groupedByAddress.values()];
      const BATCH = 25;
      const allResults: GeocodedItem[] = [];
      const failures: GeocodeFailure[] = [];

      for (let i = 0; i < uniqueGroups.length; i += BATCH) {
        const batch = uniqueGroups.slice(i, i + BATCH);
        const addresses = batch.map((group) => group[0].endereco!);

        const { data, error } = await supabase.functions.invoke("google-maps", {
          body: { action: "geocode", addresses, refresh: forceRefresh },
        });

        if (error) throw error;

        const results = data?.results || [];
        for (let j = 0; j < batch.length; j++) {
          const r = results[j];
          const group = batch[j];
          if (Number.isFinite(Number(r?.lat)) && Number.isFinite(Number(r?.lng))) {
            for (const item of group) {
              allResults.push({
                ...item,
                lat: Number(r.lat),
                lng: Number(r.lng),
                formatted_address: r.formatted || item.endereco || "",
              });
            }
          } else {
            const reason = r?.error
              || (r?.status === "ZERO_RESULTS" ? "Endereço não localizado pelo Google" : "Falha ao geocodificar o endereço");
            for (const item of group) failures.push({ item, reason, providerStatus: r?.status || null });
          }
        }

        if (runId !== geocodeRunRef.current) return;
        setGeocodeProgress({ done: Math.min(i + batch.length, uniqueGroups.length), total: uniqueGroups.length });
      }

      if (runId !== geocodeRunRef.current) return;
      setGeocodedItems(allResults);
      setGeocodeFailures(failures);
      geocodedSignatureRef.current = itemsSignature;
      setSelectedRouteIds((current) => {
        const validIds = new Set(allResults.map(itemKey));
        const kept = new Set([...current].filter((id) => validIds.has(id)));
        return kept.size > 0 ? kept : validIds;
      });

      if (forceRefresh) {
        toast.success(`${allResults.length} OS localizadas; ${failures.length} endereço(s) com falha`);
      }

      // Fit bounds
      if (mapRef.current && allResults.length > 0) {
        const bounds = new google.maps.LatLngBounds();
        allResults.forEach((item) => bounds.extend({ lat: item.lat, lng: item.lng }));
        mapRef.current.fitBounds(bounds, 60);
      }
    } catch (err: any) {
      if (runId !== geocodeRunRef.current) return;
      toast.error(`Erro no geocoding: ${err.message}`);
    } finally {
      if (runId === geocodeRunRef.current) setGeocoding(false);
    }
  }, [items, itemsSignature]);

  // Auto-geocode when map loads
  const autoOptimizeTriggered = useRef(false);
  const routeItems = useMemo(
    () => geocodedItems.filter((item) => selectedRouteIds.has(itemKey(item))),
    [geocodedItems, selectedRouteIds],
  );

  useEffect(() => {
    if (isLoaded && items.length > 0 && geocodedSignatureRef.current !== itemsSignature && !geocoding) {
      void geocodeItems(false);
    }
  }, [isLoaded, items.length, itemsSignature, geocodeItems, geocoding]);

  useEffect(() => {
    autoOptimizeTriggered.current = false;
    setRouteResult(null);
    setRoutePath([]);
  }, [itemsSignature]);

  // Reenquadra o mapa quando a rota de corredor muda
  useEffect(() => {
    if (!mapRef.current || corridorPath.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    corridorPath.forEach((point) => bounds.extend(point));
    mapRef.current.fitBounds(bounds, 60);
  }, [corridorPath]);

  // Optimize route
  const optimizeRoute = useCallback(async () => {
    if (routeItems.length < 2) {
      toast.warning("Selecione pelo menos 2 paradas para criar a rota");
      return;
    }

    setOptimizing(true);
    try {
      const origin = `${routeItems[0].lat},${routeItems[0].lng}`;
      const destination = `${routeItems[routeItems.length - 1].lat},${routeItems[routeItems.length - 1].lng}`;
      const waypoints = routeItems.length > 2
        ? routeItems.slice(1, -1).map((i) => `${i.lat},${i.lng}`)
        : [];

      const { data, error } = await supabase.functions.invoke("google-maps", {
        body: { action: "directions", origin, destination, waypoints },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setRouteResult(data);

      // Decode polyline
      if ((data?.polyline || data?.polylines?.length) && isLoaded) {
        const encodedSegments: string[] = data?.polylines?.length ? data.polylines : [data.polyline];
        const decoded = encodedSegments.flatMap((segment) => (
          google.maps.geometry.encoding.decodePath(segment)
            .map((point: google.maps.LatLng) => ({ lat: point.lat(), lng: point.lng() }))
        ));
        setRoutePath(decoded);
      }

      toast.success(`Rota otimizada: ${data.total_distance_km}km, ~${data.total_duration_min}min`);
    } catch (err: any) {
      toast.error(`Erro na rota: ${err.message}`);
    } finally {
      setOptimizing(false);
    }
  }, [routeItems, isLoaded]);

  // Auto-optimize after geocoding when autoOptimize is set.
  useEffect(() => {
    if (autoOptimize && routeItems.length >= 2 && !autoOptimizeTriggered.current && !optimizing && !routeResult) {
      autoOptimizeTriggered.current = true;
      void optimizeRoute();
    }
  }, [autoOptimize, routeItems.length, optimizing, routeResult, optimizeRoute]);

  // Open Google Maps with all waypoints
  const openInGoogleMaps = useCallback(() => {
    if (routeItems.length === 0) return;

    if (routeItems.length === 1) {
      const i = routeItems[0];
      window.open(`https://www.google.com/maps/search/?api=1&query=${i.lat},${i.lng}`, "_blank");
      return;
    }

    const mapsItems = routeItems.slice(0, 10);
    if (routeItems.length > mapsItems.length) {
      toast.warning(`Google Maps abriu as 10 primeiras de ${routeItems.length} paradas selecionadas`);
    }
    const origin = `${mapsItems[0].lat},${mapsItems[0].lng}`;
    const dest = `${mapsItems[mapsItems.length - 1].lat},${mapsItems[mapsItems.length - 1].lng}`;
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;

    if (mapsItems.length > 2) {
      const wps = mapsItems.slice(1, -1).map((i) => `${i.lat},${i.lng}`).join("|");
      url += `&waypoints=${wps}`;
    }

    window.open(url, "_blank");
  }, [routeItems]);

  if (loadError) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">
        <p className="text-sm">Erro ao carregar Google Maps: {loadError.message}</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando mapa...
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-220px)] gap-4 p-4">
      {/* Map */}
      <div className="flex-1 relative rounded-lg overflow-hidden border">
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={defaultCenter}
          zoom={5}
          onLoad={onMapLoad}
          options={{
            gestureHandling: "greedy",
            zoomControl: true,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: true,
          }}
        >
          {geocodedItems.map((item) => {
            const city = cityMap.get(item.auvo_task_id);
            const color = city ? cityColorMap.get(city) : null;
            const pinBg = color?.bg || "#3b82f6";

            return (
              <Marker
                key={itemKey(item)}
                position={{ lat: item.lat, lng: item.lng }}
                label={{
                  text: item.gc_os_codigo ? item.gc_os_codigo.slice(-2) : "•",
                  color: "white",
                  fontWeight: "bold",
                  fontSize: "11px",
                }}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 14,
                  fillColor: pinBg,
                  fillOpacity: 1,
                  strokeColor: "white",
                  strokeWeight: 2,
                }}
                onClick={() => setSelectedMarker(item)}
              />
            );
          })}

          {selectedMarker && (
            <InfoWindow
              position={{ lat: selectedMarker.lat, lng: selectedMarker.lng }}
              onCloseClick={() => setSelectedMarker(null)}
            >
              <div className="p-1 max-w-[220px]">
                <p className="font-semibold text-sm">OS {selectedMarker.gc_os_codigo}</p>
                <p className="text-xs">{selectedMarker.cliente}</p>
                <p className="text-xs text-gray-500 mt-1">{selectedMarker.formatted_address}</p>
                <p className="text-xs font-medium mt-1">{formatCurrency(Number(selectedMarker.gc_os_valor_total) || 0)}</p>
                <p className="text-[10px] text-gray-500 mt-1">
                  {selectedMarker.tecnico || "Sem técnico"} · {selectedMarker.gc_os_situacao || selectedMarker.status_auvo || "Sem status"}
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    className="text-blue-600 hover:underline text-[10px]"
                    onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${selectedMarker.lat},${selectedMarker.lng}`, "_blank")}
                  >
                    📍 Maps
                  </button>
                  <button
                    className="text-blue-600 hover:underline text-[10px]"
                    onClick={() => onSelectCard(selectedMarker)}
                  >
                    📄 Detalhes
                  </button>
                </div>
              </div>
            </InfoWindow>
          )}

          {routePath.length > 0 && (
            <Polyline
              path={routePath}
              options={{
                strokeColor: "#3b82f6",
                strokeOpacity: 0.8,
                strokeWeight: 4,
                geodesic: true,
              }}
            />
          )}

          {/* Corridor route polyline + origin/destination markers */}
          {corridorRoute && corridorPath.length > 0 && (
            <>
              <Polyline
                key={`corridor-line-${corridorRoute.encodedPolyline}`}
                path={corridorPath}
                options={{
                  strokeColor: "#8b5cf6",
                  strokeOpacity: 0.6,
                  strokeWeight: 5,
                  geodesic: true,
                  zIndex: 1,
                }}
              />
              <Marker
                key={`corridor-origin-${corridorRoute.encodedPolyline}`}
                position={corridorRoute.originCoord}
                label={{ text: "A", color: "#fff", fontWeight: "bold", fontSize: "12px" }}
                title={corridorRoute.originLabel}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 14,
                  fillColor: "#22c55e",
                  fillOpacity: 1,
                  strokeColor: "#fff",
                  strokeWeight: 2,
                }}
              />
              <Marker
                key={`corridor-dest-${corridorRoute.encodedPolyline}`}
                position={corridorRoute.destCoord}
                label={{ text: "B", color: "#fff", fontWeight: "bold", fontSize: "12px" }}
                title={corridorRoute.destLabel}
                icon={{
                  path: google.maps.SymbolPath.CIRCLE,
                  scale: 14,
                  fillColor: "#ef4444",
                  fillOpacity: 1,
                  strokeColor: "#fff",
                  strokeWeight: 2,
                }}
              />
            </>
          )}
        </GoogleMap>

        {/* Map overlay controls */}
        <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-2 z-10 pointer-events-none">
          <Button
            size="sm"
            variant="secondary"
            className="shadow-md gap-1.5 pointer-events-auto"
            onClick={() => void geocodeItems(true)}
            disabled={geocoding}
          >
            {geocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {geocoding
              ? `Localizando ${geocodeProgress.done}/${geocodeProgress.total}`
              : "Atualizar endereços"}
          </Button>

          <Badge className="h-9 px-3 gap-1.5 shadow-md bg-card text-foreground border pointer-events-auto">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            {geocodedItems.length} no mapa
          </Badge>

          {(missingAddressItems.length + geocodeFailures.length) > 0 && (
            <Badge className="h-9 px-3 gap-1.5 shadow-md bg-card text-foreground border pointer-events-auto">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              {missingAddressItems.length + geocodeFailures.length} pendência(s)
            </Badge>
          )}

          <Button
            size="sm"
            variant="secondary"
            className="shadow-md gap-1.5 pointer-events-auto ml-auto"
            onClick={optimizeRoute}
            disabled={optimizing || routeItems.length < 2}
          >
            {optimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Route className="h-3.5 w-3.5" />}
            Otimizar {routeItems.length} paradas
          </Button>

          <Button
            size="sm"
            variant="secondary"
            className="shadow-md gap-1.5 pointer-events-auto"
            onClick={openInGoogleMaps}
            disabled={routeItems.length === 0}
          >
            <Navigation className="h-3.5 w-3.5" />
            Abrir no Maps
          </Button>
        </div>

        {/* Route summary overlay */}
        {routeResult && (
          <div className="absolute bottom-3 left-3 right-3 bg-card/95 backdrop-blur rounded-lg border shadow-lg p-3 z-10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Badge variant="secondary" className="gap-1">
                  🛣️ {routeResult.total_distance_km} km
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  ⏱️ ~{routeResult.total_duration_min} min
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  📍 {routeItems.length} paradas
                </Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => {
                setRouteResult(null);
                setRoutePath([]);
              }}>
                Limpar rota
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar operacional: pontos, seleção de rota e diagnóstico real. */}
      <div className="w-[380px] flex-shrink-0 border rounded-lg bg-card overflow-hidden flex flex-col">
        <div className="px-3 py-3 border-b bg-muted/30 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Central de rotas</p>
              <p className="text-xs text-muted-foreground">
                {items.length} OS filtradas · {routeItems.length} selecionadas
              </p>
            </div>
            {geocoding && (
              <Badge variant="outline" className="gap-1 font-normal">
                <Loader2 className="h-3 w-3 animate-spin" /> {geocodeProgress.done}/{geocodeProgress.total}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            <Button
              size="sm"
              variant={sidebarMode === "mapped" ? "secondary" : "ghost"}
              className="h-8 px-1 text-[11px] gap-1"
              onClick={() => setSidebarMode("mapped")}
            >
              <MapPin className="h-3 w-3" /> Mapa {geocodedItems.length}
            </Button>
            <Button
              size="sm"
              variant={sidebarMode === "missing" ? "secondary" : "ghost"}
              className="h-8 px-1 text-[11px] gap-1"
              onClick={() => setSidebarMode("missing")}
            >
              <AlertTriangle className="h-3 w-3" /> Sem dado {missingAddressItems.length}
            </Button>
            <Button
              size="sm"
              variant={sidebarMode === "failed" ? "secondary" : "ghost"}
              className="h-8 px-1 text-[11px] gap-1"
              onClick={() => setSidebarMode("failed")}
            >
              <AlertTriangle className="h-3 w-3" /> Falhou {geocodeFailures.length}
            </Button>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={listSearch}
              onChange={(event) => setListSearch(event.target.value)}
              placeholder="Buscar OS, cliente ou técnico..."
              className="h-9 pl-8 text-xs"
            />
          </div>

          {sidebarMode === "mapped" && geocodedItems.length > 0 && (
            <div className="flex items-center justify-between text-[11px]">
              <button
                className="text-primary hover:underline"
                onClick={() => setSelectedRouteIds(new Set(geocodedItems.map(itemKey)))}
              >
                Selecionar todos
              </button>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedRouteIds(new Set())}
              >
                Limpar rota
              </button>
            </div>
          )}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-1.5">
            {sidebarMode === "mapped" && geocodedItems
              .filter((item) => {
                const q = listSearch.trim().toLowerCase();
                return !q || [item.gc_os_codigo, item.cliente, item.tecnico, item.gc_os_situacao]
                  .some((value) => String(value || "").toLowerCase().includes(q));
              })
              .map((item, idx) => {
                const city = cityMap.get(item.auvo_task_id);
                const color = city ? cityColorMap.get(city) : null;
                const isSelected = selectedMarker && itemKey(selectedMarker) === itemKey(item);
                const isRouteStop = selectedRouteIds.has(itemKey(item));

                return (
                  <div
                    key={itemKey(item)}
                    className={`rounded border px-2.5 py-2 text-xs cursor-pointer transition-colors ${
                      isSelected ? "bg-accent border-primary/40 ring-1 ring-primary/20" : "bg-card hover:bg-accent/50"
                    }`}
                    onClick={() => {
                      setSelectedMarker(item);
                      mapRef.current?.panTo({ lat: item.lat, lng: item.lng });
                      mapRef.current?.setZoom(15);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Checkbox
                          checked={isRouteStop}
                          aria-label={`Selecionar OS ${item.gc_os_codigo} para rota`}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={(checked) => setSelectedRouteIds((current) => {
                            const next = new Set(current);
                            if (checked) next.add(itemKey(item));
                            else next.delete(itemKey(item));
                            return next;
                          })}
                        />
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white shadow-sm"
                          style={{ backgroundColor: color?.bg || "#3b82f6" }}
                        />
                        <span className="font-mono font-medium truncate">{idx + 1}. OS {item.gc_os_codigo || "—"}</span>
                      </div>
                      <span className="font-medium whitespace-nowrap">{formatCurrency(Number(item.gc_os_valor_total) || 0)}</span>
                    </div>
                    <p className="font-medium truncate mt-1">{item.cliente || item.gc_os_cliente || "Cliente não informado"}</p>
                    <p className="text-muted-foreground truncate">{item.formatted_address}</p>
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal">
                          {item.map_address_source === "rh_clientes" ? "RH > Clientes" : "Tarefa Auvo"}
                        </Badge>
                        {item.tecnico && <span className="text-[10px] text-muted-foreground truncate">{item.tecnico}</span>}
                      </div>
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <button
                          className="text-primary hover:underline text-[10px] inline-flex items-center gap-0.5"
                          onClick={(event) => {
                            event.stopPropagation();
                            window.open(`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`, "_blank");
                          }}
                        >
                          <Navigation className="h-2.5 w-2.5" /> Maps
                        </button>
                        <button
                          className="text-primary hover:underline text-[10px] inline-flex items-center gap-0.5"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectCard(item);
                          }}
                        >
                          <ExternalLink className="h-2.5 w-2.5" /> OS
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

            {sidebarMode === "missing" && missingAddressItems
              .filter((item) => {
                const q = listSearch.trim().toLowerCase();
                return !q || [item.gc_os_codigo, item.cliente, item.gc_os_cliente, item.tecnico]
                  .some((value) => String(value || "").toLowerCase().includes(q));
              })
              .map((item) => (
                <div key={itemKey(item)} className="rounded border border-amber-200 bg-amber-50/60 px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium">OS {item.gc_os_codigo || "—"}</span>
                    <button className="text-primary hover:underline text-[10px]" onClick={() => onSelectCard(item)}>Detalhes</button>
                  </div>
                  <p className="font-medium truncate mt-1">{item.cliente || item.gc_os_cliente || "Cliente não informado"}</p>
                  <p className="text-amber-800 mt-1 flex gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    {item.map_address_issue || "A tarefa e o cliente não possuem endereço utilizável"}
                  </p>
                  {item.map_client_id && (
                    <a href="/rh/clientes" className="text-primary hover:underline text-[10px] mt-1 inline-block">
                      Abrir RH &gt; Clientes para corrigir
                    </a>
                  )}
                </div>
              ))}

            {sidebarMode === "failed" && geocodeFailures
              .filter(({ item }) => {
                const q = listSearch.trim().toLowerCase();
                return !q || [item.gc_os_codigo, item.cliente, item.gc_os_cliente, item.tecnico]
                  .some((value) => String(value || "").toLowerCase().includes(q));
              })
              .map(({ item, reason, providerStatus }) => (
                <div key={itemKey(item)} className="rounded border border-red-200 bg-red-50/60 px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium">OS {item.gc_os_codigo || "—"}</span>
                    <button className="text-primary hover:underline text-[10px]" onClick={() => onSelectCard(item)}>Detalhes</button>
                  </div>
                  <p className="font-medium truncate mt-1">{item.cliente || item.gc_os_cliente || "Cliente não informado"}</p>
                  <p className="text-muted-foreground break-words mt-0.5">{item.endereco}</p>
                  <p className="text-red-700 mt-1">{reason}{providerStatus ? ` (${providerStatus})` : ""}</p>
                </div>
              ))}

            {!geocoding && sidebarMode === "mapped" && geocodedItems.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                <MapPin className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">Nenhuma OS localizada</p>
                <p className="text-xs mt-1">Abra “Sem dado” e “Falhou” para ver a causa de cada item.</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t bg-muted/30 px-3 py-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground inline-flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5" /> {routeItems.length} parada(s)
          </span>
          <Button size="sm" className="h-8 gap-1.5" onClick={optimizeRoute} disabled={optimizing || routeItems.length < 2}>
            <Route className="h-3.5 w-3.5" /> Montar rota
          </Button>
        </div>
      </div>
    </div>
  );
}
