/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Navigation, MapPin, ExternalLink, Route } from "lucide-react";
import { toast } from "sonner";

declare const google: any;

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

interface OSMapViewProps {
  items: OSItem[];
  cityColorMap: globalThis.Map<string, { bg: string; text: string }>;
  cityMap: globalThis.Map<string, string>;
  formatCurrency: (val: number) => string;
  onSelectCard: (item: OSItem) => void;
}

export default function OSMapView({ items, cityColorMap, cityMap, formatCurrency, onSelectCard }: OSMapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodedItems, setGeocodedItems] = useState<GeocodedItem[]>([]);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<GeocodedItem | null>(null);

  // Fetch API key
  useEffect(() => {
    supabase.functions.invoke("google-maps", { body: { action: "api_key" } })
      .then(({ data, error }) => {
        if (!error && data?.key) setApiKey(data.key);
        else toast.error("Erro ao carregar API Key do Google Maps");
      });
  }, []);

  // Load Google Maps JS
  useEffect(() => {
    if (!apiKey || mapLoaded) return;
    if ((window as any).google?.maps) { setMapLoaded(true); return; }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry,marker&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => setMapLoaded(true);
    script.onerror = () => toast.error("Erro ao carregar Google Maps");
    document.head.appendChild(script);
  }, [apiKey, mapLoaded]);

  // Init map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || mapInstanceRef.current) return;
    mapInstanceRef.current = new google.maps.Map(mapRef.current, {
      center: { lat: -15.7942, lng: -47.8822 }, // Brasília default
      zoom: 5,
      mapId: "os-kanban-map",
      gestureHandling: "greedy",
    });
  }, [mapLoaded]);

  // Geocode items
  const geocodeItems = useCallback(async () => {
    const addressable = items.filter((i) => i.endereco && i.endereco.length > 5);
    if (addressable.length === 0) {
      toast.warning("Nenhum item com endereço para geocodificar");
      return;
    }

    setGeocoding(true);
    try {
      // Batch in groups of 20
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
    } catch (err: any) {
      toast.error(`Erro no geocoding: ${err.message}`);
    } finally {
      setGeocoding(false);
    }
  }, [items]);

  // Auto-geocode when map loads
  useEffect(() => {
    if (mapLoaded && items.length > 0 && geocodedItems.length === 0 && !geocoding) {
      geocodeItems();
    }
  }, [mapLoaded, items.length]);

  // Place markers
  useEffect(() => {
    if (!mapInstanceRef.current || geocodedItems.length === 0) return;

    // Clear old markers
    markersRef.current.forEach((m) => (m.map = null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();

    for (const item of geocodedItems) {
      const city = cityMap.get(item.auvo_task_id);
      const color = city ? cityColorMap.get(city) : null;
      const pinBg = color?.bg || "#3b82f6";

      const pinEl = document.createElement("div");
      pinEl.style.cssText = `
        width: 28px; height: 28px; border-radius: 50%; 
        background: ${pinBg}; border: 2px solid white; 
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        font-size: 12px; color: white; font-weight: bold;
      `;
      pinEl.textContent = item.gc_os_codigo ? item.gc_os_codigo.slice(-2) : "•";

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: mapInstanceRef.current!,
        position: { lat: item.lat, lng: item.lng },
        content: pinEl,
        title: `OS ${item.gc_os_codigo} - ${item.cliente}`,
      });

      marker.addListener("click", () => {
        setSelectedMarker(item);
      });

      markersRef.current.push(marker);
      bounds.extend({ lat: item.lat, lng: item.lng });
    }

    mapInstanceRef.current.fitBounds(bounds, 60);
  }, [geocodedItems, cityMap, cityColorMap]);

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

      // Draw polyline
      if (data?.polyline && mapInstanceRef.current) {
        if (polylineRef.current) polylineRef.current.setMap(null);

        const path = google.maps.geometry.encoding.decodePath(data.polyline);
        polylineRef.current = new google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: "#3b82f6",
          strokeOpacity: 0.8,
          strokeWeight: 4,
          map: mapInstanceRef.current,
        });
      }

      toast.success(`Rota otimizada: ${data.total_distance_km}km, ~${data.total_duration_min}min`);
    } catch (err: any) {
      toast.error(`Erro na rota: ${err.message}`);
    } finally {
      setOptimizing(false);
    }
  }, [geocodedItems]);

  // Open Google Maps with all waypoints
  const openInGoogleMaps = useCallback(() => {
    if (geocodedItems.length === 0) return;

    if (geocodedItems.length === 1) {
      const i = geocodedItems[0];
      window.open(`https://www.google.com/maps/search/?api=1&query=${i.lat},${i.lng}`, "_blank");
      return;
    }

    // Use directions URL with waypoints
    const origin = `${geocodedItems[0].lat},${geocodedItems[0].lng}`;
    const dest = `${geocodedItems[geocodedItems.length - 1].lat},${geocodedItems[geocodedItems.length - 1].lng}`;
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;

    if (geocodedItems.length > 2) {
      const wps = geocodedItems.slice(1, -1).map((i) => `${i.lat},${i.lng}`).join("|");
      url += `&waypoints=${wps}`;
    }

    window.open(url, "_blank");
  }, [geocodedItems]);

  if (!apiKey) {
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
        <div ref={mapRef} className="w-full h-full" />

        {/* Map overlay controls */}
        <div className="absolute top-3 left-3 flex gap-2">
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
          <div className="absolute bottom-3 left-3 right-3 bg-card/95 backdrop-blur rounded-lg border shadow-lg p-3">
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
                if (polylineRef.current) polylineRef.current.setMap(null);
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
                    mapInstanceRef.current?.panTo({ lat: item.lat, lng: item.lng });
                    mapInstanceRef.current?.setZoom(15);
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
