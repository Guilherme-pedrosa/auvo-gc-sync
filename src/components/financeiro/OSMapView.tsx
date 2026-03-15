/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Navigation, MapPin, ExternalLink, Route } from "lucide-react";
import { toast } from "sonner";

type OSItem = {
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
}: OSMapViewProps & { apiKey: string }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    language: "pt-BR",
    libraries: LIBRARIES,
  });

  const mapRef = useRef<google.maps.Map | null>(null);

  const [geocoding, setGeocoding] = useState(false);
  const [geocodedItems, setGeocodedItems] = useState<GeocodedItem[]>([]);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routePath, setRoutePath] = useState<google.maps.LatLngLiteral[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<GeocodedItem | null>(null);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // Geocode items
  const geocodeItems = useCallback(async () => {
    const addressable = items.filter((i) => i.endereco && i.endereco.length > 5);
    if (addressable.length === 0) {
      toast.warning("Nenhum item com endereço para geocodificar");
      return;
    }

    setGeocoding(true);
    try {
      const BATCH = 20;
      const allResults: GeocodedItem[] = [];

      for (let i = 0; i < addressable.length; i += BATCH) {
        const batch = addressable.slice(i, i + BATCH);
        const addresses = batch.map((b) => b.endereco!);

        const { data, error } = await supabase.functions.invoke("google-maps", {
          body: { action: "geocode", addresses },
        });

        if (error) throw error;

        const results = data?.results || [];
        for (let j = 0; j < batch.length; j++) {
          const r = results[j];
          if (r?.lat && r?.lng) {
            allResults.push({
              ...batch[j],
              lat: r.lat,
              lng: r.lng,
              formatted_address: r.formatted || batch[j].endereco || "",
            });
          }
        }
      }

      setGeocodedItems(allResults);
      toast.success(`${allResults.length}/${addressable.length} endereços geocodificados`);

      // Fit bounds
      if (mapRef.current && allResults.length > 0) {
        const bounds = new google.maps.LatLngBounds();
        allResults.forEach((item) => bounds.extend({ lat: item.lat, lng: item.lng }));
        mapRef.current.fitBounds(bounds, 60);
      }
    } catch (err: any) {
      toast.error(`Erro no geocoding: ${err.message}`);
    } finally {
      setGeocoding(false);
    }
  }, [items]);

  // Auto-geocode when map loads
  const autoOptimizeTriggered = useRef(false);
  useEffect(() => {
    if (isLoaded && items.length > 0 && geocodedItems.length === 0 && !geocoding) {
      geocodeItems();
    }
  }, [isLoaded, items.length]);

  // Auto-optimize after geocoding when autoOptimize is set
  useEffect(() => {
    if (autoOptimize && geocodedItems.length >= 2 && !autoOptimizeTriggered.current && !optimizing && !routeResult) {
      autoOptimizeTriggered.current = true;
      optimizeRoute();
    }
  }, [autoOptimize, geocodedItems.length, optimizing, routeResult]);

  // Optimize route
  const optimizeRoute = useCallback(async () => {
    if (geocodedItems.length < 2) {
      toast.warning("Precisa de pelo menos 2 pontos para criar rota");
      return;
    }

    setOptimizing(true);
    try {
      const origin = `${geocodedItems[0].lat},${geocodedItems[0].lng}`;
      const destination = `${geocodedItems[geocodedItems.length - 1].lat},${geocodedItems[geocodedItems.length - 1].lng}`;
      const waypoints = geocodedItems.length > 2
        ? geocodedItems.slice(1, -1).map((i) => `${i.lat},${i.lng}`)
        : [];

      const { data, error } = await supabase.functions.invoke("google-maps", {
        body: { action: "directions", origin, destination, waypoints },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setRouteResult(data);

      // Decode polyline
      if (data?.polyline && isLoaded) {
        const path = google.maps.geometry.encoding.decodePath(data.polyline);
        setRoutePath(path.map((p: google.maps.LatLng) => ({ lat: p.lat(), lng: p.lng() })));
      }

      toast.success(`Rota otimizada: ${data.total_distance_km}km, ~${data.total_duration_min}min`);
    } catch (err: any) {
      toast.error(`Erro na rota: ${err.message}`);
    } finally {
      setOptimizing(false);
    }
  }, [geocodedItems, isLoaded]);

  // Open Google Maps with all waypoints
  const openInGoogleMaps = useCallback(() => {
    if (geocodedItems.length === 0) return;

    if (geocodedItems.length === 1) {
      const i = geocodedItems[0];
      window.open(`https://www.google.com/maps/search/?api=1&query=${i.lat},${i.lng}`, "_blank");
      return;
    }

    const origin = `${geocodedItems[0].lat},${geocodedItems[0].lng}`;
    const dest = `${geocodedItems[geocodedItems.length - 1].lat},${geocodedItems[geocodedItems.length - 1].lng}`;
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;

    if (geocodedItems.length > 2) {
      const wps = geocodedItems.slice(1, -1).map((i) => `${i.lat},${i.lng}`).join("|");
      url += `&waypoints=${wps}`;
    }

    window.open(url, "_blank");
  }, [geocodedItems]);

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
                key={item.auvo_task_id}
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
          {corridorRoute && isLoaded && (() => {
            const path = google.maps.geometry.encoding.decodePath(corridorRoute.encodedPolyline);
            const corridorPath = path.map((p: google.maps.LatLng) => ({ lat: p.lat(), lng: p.lng() }));
            return (
              <>
                <Polyline
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
            );
          })()}
        </GoogleMap>

        {/* Map overlay controls */}
        <div className="absolute top-3 left-3 flex gap-2 z-10">
          <Button
            size="sm"
            variant="secondary"
            className="shadow-md gap-1.5"
            onClick={geocodeItems}
            disabled={geocoding}
          >
            {geocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
            {geocoding ? "Geocodificando..." : `📍 ${geocodedItems.length} pins`}
          </Button>

          <Button
            size="sm"
            variant="secondary"
            className="shadow-md gap-1.5"
            onClick={optimizeRoute}
            disabled={optimizing || geocodedItems.length < 2}
          >
            {optimizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Route className="h-3.5 w-3.5" />}
            Otimizar Rota
          </Button>

          <Button
            size="sm"
            variant="secondary"
            className="shadow-md gap-1.5"
            onClick={openInGoogleMaps}
            disabled={geocodedItems.length === 0}
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
                  📍 {geocodedItems.length} paradas
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

      {/* Sidebar - geocoded items list */}
      <div className="w-[320px] flex-shrink-0 border rounded-lg bg-card">
        <div className="px-3 py-2 border-b bg-muted/50">
          <p className="text-sm font-semibold">📍 Pontos no Mapa ({geocodedItems.length})</p>
          <p className="text-xs text-muted-foreground">
            {items.length - geocodedItems.length > 0 && `${items.length - geocodedItems.length} sem endereço`}
          </p>
        </div>
        <ScrollArea className="h-[calc(100%-60px)]">
          <div className="p-2 space-y-1.5">
            {geocodedItems.map((item, idx) => {
              const city = cityMap.get(item.auvo_task_id);
              const color = city ? cityColorMap.get(city) : null;
              const isSelected = selectedMarker?.auvo_task_id === item.auvo_task_id;

              return (
                <div
                  key={item.auvo_task_id}
                  className={`rounded border px-2.5 py-2 text-xs cursor-pointer transition-colors ${
                    isSelected ? "bg-accent border-primary/40 ring-1 ring-primary/20" : "bg-card hover:bg-accent/50"
                  }`}
                  onClick={() => {
                    setSelectedMarker(item);
                    mapRef.current?.panTo({ lat: item.lat, lng: item.lng });
                    mapRef.current?.setZoom(15);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0 border border-white shadow-sm"
                        style={{ backgroundColor: color?.bg || "#3b82f6" }}
                      />
                      <span className="font-mono text-muted-foreground">
                        {routeResult ? `#${routeResult.waypoint_order.indexOf(idx - 1) + 2 || idx + 1}` : `${idx + 1}.`}
                        {" "}OS {item.gc_os_codigo || "—"}
                      </span>
                    </div>
                    <span className="font-medium">{formatCurrency(Number(item.gc_os_valor_total) || 0)}</span>
                  </div>
                  <p className="font-medium truncate mt-0.5">{item.cliente || "—"}</p>
                  <p className="text-muted-foreground truncate">{item.formatted_address}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      className="text-primary hover:underline text-[10px] inline-flex items-center gap-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`, "_blank");
                      }}
                    >
                      <Navigation className="h-2.5 w-2.5" /> Maps
                    </button>
                    <button
                      className="text-primary hover:underline text-[10px] inline-flex items-center gap-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCard(item);
                      }}
                    >
                      <ExternalLink className="h-2.5 w-2.5" /> Detalhes
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
