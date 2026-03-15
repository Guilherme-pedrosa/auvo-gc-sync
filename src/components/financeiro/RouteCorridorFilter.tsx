import { useState, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Route, X, MapPin, Search, Map as MapIcon } from "lucide-react";
import { toast } from "sonner";

interface OSInfo {
  auvo_task_id: string;
  gc_os_codigo?: string;
  cliente?: string;
  cidade?: string;
}

export interface CorridorRouteData {
  encodedPolyline: string;
  originCoord: { lat: number; lng: number };
  destCoord: { lat: number; lng: number };
  originLabel: string;
  destLabel: string;
}

interface RouteCorridorFilterProps {
  allCities: string[];
  cityMap: Map<string, string>; // taskId → city/region
  osItems?: OSInfo[];
  onFilterChange: (matchingTaskIds: Set<string> | null) => void;
  onShowMap?: () => void;
  onCorridorRouteChange?: (route: CorridorRouteData | null) => void;
}

// Haversine distance in km
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Minimum distance from a point to any point on a polyline, returns { dist, index }
function minDistToPolylineWithIndex(
  lat: number,
  lng: number,
  polylinePoints: { lat: number; lng: number }[],
): { dist: number; index: number } {
  let min = Infinity;
  let minIdx = 0;
  for (let i = 0; i < polylinePoints.length; i++) {
    const d = haversineKm(lat, lng, polylinePoints[i].lat, polylinePoints[i].lng);
    if (d < min) { min = d; minIdx = i; }
  }
  return { dist: min, index: minIdx };
}

// Decode Google encoded polyline
function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

// Sample polyline to reduce computation (every Nth point)
function samplePolyline(points: { lat: number; lng: number }[], maxPoints = 200): { lat: number; lng: number }[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const sampled: { lat: number; lng: number }[] = [];
  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i]);
  }
  // Always include last point
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }
  return sampled;
}

// Autocomplete for destination field
function DestinationAutocomplete({
  value,
  onChange,
  allCities,
  osItems,
}: {
  value: string;
  onChange: (v: string) => void;
  allCities: string[];
  osItems: OSInfo[];
}) {
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const query = value.toLowerCase().trim();

  const suggestions = useMemo(() => {
    if (!query) return [];
    const results: { label: string; sublabel?: string; value: string; type: "city" | "os" }[] = [];

    // Match cities
    for (const city of allCities) {
      if (city.toLowerCase().includes(query)) {
        results.push({ label: city, value: city, type: "city" });
      }
      if (results.length >= 8) break;
    }

    // Match OS by code or client
    for (const os of osItems) {
      if (results.length >= 12) break;
      const code = os.gc_os_codigo || "";
      const client = os.cliente || "";
      if (code.toLowerCase().includes(query) || client.toLowerCase().includes(query)) {
        const city = os.cidade || "Sem cidade";
        results.push({
          label: `OS ${code}`,
          sublabel: `${client} • ${city}`,
          value: city,
          type: "os",
        });
      }
    }

    return results;
  }, [query, allCities, osItems]);

  const showDropdown = focused && query.length > 0 && suggestions.length > 0;

  return (
    <div className="relative" ref={containerRef}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
      <Input
        className="h-8 text-sm pl-8"
        placeholder="Nº da OS ou cidade (ex: Cuiabá - MT)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
      />
      {showDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md overflow-hidden">
          <ScrollArea className="max-h-[200px]">
            {suggestions.map((s, i) => (
              <button
                key={`${s.type}-${s.value}-${i}`}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(s.value);
                  setFocused(false);
                }}
              >
                {s.type === "city" ? (
                  <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">OS</Badge>
                )}
                <div className="min-w-0">
                  <span className="block truncate">{s.label}</span>
                  {s.sublabel && (
                    <span className="block text-[10px] text-muted-foreground truncate">{s.sublabel}</span>
                  )}
                </div>
              </button>
            ))}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

const PRESET_ORIGINS = [
  "Anápolis - GO",
  "Goiânia - GO",
  "Brasília - DF",
  "Senador Canedo - GO",
];

export default function RouteCorridorFilter({
  allCities,
  cityMap,
  osItems = [],
  onFilterChange,
  onShowMap,
  onCorridorRouteChange,
}: RouteCorridorFilterProps) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("Anápolis - GO");
  const [destination, setDestination] = useState("");
  const [radiusKm, setRadiusKm] = useState(50);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<{
    origin: string;
    destination: string;
    radius: number;
    matchCount: number;
    totalCities: number;
    matchedCities: string[];
    cityDirection: Map<string, "ida" | "volta">;
    distanceKm: number;
    durationMin: number;
  } | null>(null);

  const applyFilter = useCallback(async () => {
    if (!origin || !destination) {
      toast.warning("Selecione origem e destino");
      return;
    }

    setLoading(true);
    try {
      // 1. Get unique cities from cityMap
      const uniqueCities = new Set<string>();
      for (const [, city] of cityMap) uniqueCities.add(city);
      const cityList = Array.from(uniqueCities);

      // 2. Geocode origin, destination, and all unique cities
      const addressesToGeocode = [
        origin.includes(" - ") ? origin.split(" - ")[0] + ", " + origin.split(" - ")[1] + ", Brasil" : origin + ", Brasil",
        destination.includes(" - ") ? destination.split(" - ")[0] + ", " + destination.split(" - ")[1] + ", Brasil" : destination + ", Brasil",
        ...cityList.map((c) => {
          if (c.includes(" - ")) return c.split(" - ")[0] + ", " + c.split(" - ")[1] + ", Brasil";
          return c + ", Brasil";
        }),
      ];

      const { data: geoData, error: geoError } = await supabase.functions.invoke("google-maps", {
        body: { action: "geocode", addresses: addressesToGeocode },
      });
      if (geoError) throw geoError;

      const geoResults = geoData?.results || [];
      const originCoord = geoResults[0];
      const destCoord = geoResults[1];

      if (!originCoord?.lat || !destCoord?.lat) {
        toast.error("Não foi possível geocodificar origem ou destino");
        return;
      }

      // Build city → coords map
      const cityCoords = new Map<string, { lat: number; lng: number }>();
      for (let i = 0; i < cityList.length; i++) {
        const r = geoResults[i + 2];
        if (r?.lat && r?.lng) {
          cityCoords.set(cityList[i], { lat: r.lat, lng: r.lng });
        }
      }

      // 3. Get route polyline
      const { data: dirData, error: dirError } = await supabase.functions.invoke("google-maps", {
        body: {
          action: "directions",
          origin: `${originCoord.lat},${originCoord.lng}`,
          destination: `${destCoord.lat},${destCoord.lng}`,
          waypoints: [],
        },
      });
      if (dirError) throw dirError;
      if (dirData?.error) throw new Error(dirData.error);

      const encodedPolyline = dirData?.polyline;
      if (!encodedPolyline) {
        toast.error("Não foi possível traçar rota entre origem e destino");
        return;
      }

      // 4. Decode and sample polyline
      const fullPath = decodePolyline(encodedPolyline);
      const sampledPath = samplePolyline(fullPath);

      // 5. Check each city's distance to route
      const matchedCities: string[] = [];
      for (const [city, coords] of cityCoords) {
        const dist = minDistToPolyline(coords.lat, coords.lng, sampledPath);
        if (dist <= radiusKm) {
          matchedCities.push(city);
        }
      }

      // 6. Build set of matching task IDs
      const matchingIds = new Set<string>();
      for (const [taskId, city] of cityMap) {
        if (matchedCities.includes(city)) {
          matchingIds.add(taskId);
        }
      }

      const distKm = dirData?.total_distance_km || 0;
      const durMin = dirData?.total_duration_min || 0;

      setActiveFilter({
        origin,
        destination,
        radius: radiusKm,
        matchCount: matchingIds.size,
        totalCities: cityList.length,
        matchedCities,
        distanceKm: distKm,
        durationMin: durMin,
      });

      onFilterChange(matchingIds);
      onCorridorRouteChange?.({
        encodedPolyline: encodedPolyline,
        originCoord: { lat: originCoord.lat, lng: originCoord.lng },
        destCoord: { lat: destCoord.lat, lng: destCoord.lng },
        originLabel: origin,
        destLabel: destination,
      });
      setOpen(false);
      toast.success(
        `${matchedCities.length} cidade${matchedCities.length !== 1 ? "s" : ""} no corredor (${matchingIds.size} OS)`,
      );
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, radiusKm, cityMap, onFilterChange, onCorridorRouteChange]);

  const clearFilter = useCallback(() => {
    setActiveFilter(null);
    onFilterChange(null);
    onCorridorRouteChange?.(null);
  }, [onFilterChange, onCorridorRouteChange]);

  const excludeCity = useCallback((cityToRemove: string) => {
    if (!activeFilter) return;
    const newCities = activeFilter.matchedCities.filter((c) => c !== cityToRemove);
    if (newCities.length === 0) {
      clearFilter();
      return;
    }
    // Rebuild matching IDs without the excluded city
    const matchingIds = new Set<string>();
    for (const [taskId, city] of cityMap) {
      if (newCities.includes(city)) {
        matchingIds.add(taskId);
      }
    }
    setActiveFilter({
      ...activeFilter,
      matchedCities: newCities,
      matchCount: matchingIds.size,
    });
    onFilterChange(matchingIds);
    toast.info(`${cityToRemove} removida do corredor`, { duration: 1500, position: "bottom-center" });
  }, [activeFilter, cityMap, onFilterChange, clearFilter]);

  // Count OS per city for display
  const cityCounts = useMemo(() => {
    if (!activeFilter) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const [, city] of cityMap) {
      if (activeFilter.matchedCities.includes(city)) {
        counts.set(city, (counts.get(city) || 0) + 1);
      }
    }
    return counts;
  }, [activeFilter, cityMap]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={activeFilter ? "default" : "outline"}
            size="sm"
            className="gap-2 min-w-[140px] justify-start"
          >
            <Route className="h-4 w-4" />
            {activeFilter
              ? `🛤️ ${activeFilter.matchCount} OS no caminho`
              : "🛤️ Corredor de Rota"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0" align="start">
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">🛤️ Corredor de Rota</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Encontre OS no caminho entre duas cidades
                </p>
              </div>
              {activeFilter && (
                <Badge className="text-[10px] h-5">{activeFilter.matchCount} OS</Badge>
              )}
            </div>
          </div>

          <div className="p-4 space-y-3">
            {/* Origin & Destination in a compact grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Origem</Label>
                <Select value={origin} onValueChange={setOrigin}>
                  <SelectTrigger className="h-8 text-xs">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                      <SelectValue placeholder="Origem" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_ORIGINS.map((o) => (
                      <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                    ))}
                    {allCities
                      .filter((c) => !PRESET_ORIGINS.includes(c))
                      .map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Destino</Label>
                <DestinationAutocomplete
                  value={destination}
                  onChange={setDestination}
                  allCities={allCities}
                  osItems={osItems}
                />
              </div>
            </div>

            {/* Radius slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">Raio de desvio</Label>
                <Badge variant="outline" className="text-[10px] h-5 font-mono">{radiusKm} km</Badge>
              </div>
              <Slider
                value={[radiusKm]}
                onValueChange={([v]) => setRadiusKm(v)}
                min={10}
                max={200}
                step={10}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
                <span>10km</span>
                <span>100km</span>
                <span>200km</span>
              </div>
            </div>

            {/* Search button */}
            <Button
              className="w-full gap-2"
              onClick={applyFilter}
              disabled={loading || !origin || !destination}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Route className="h-4 w-4" />
              )}
              {loading ? "Calculando corredor..." : "Buscar OS no caminho"}
            </Button>
          </div>

          {/* Active filter results */}
          {activeFilter && (
            <div className="border-t">
              {/* Route summary */}
              <div className="px-4 py-2.5 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="font-medium text-foreground">{activeFilter.origin.split(" - ")[0]}</span>
                    <span>→</span>
                    <span className="font-medium text-foreground">{activeFilter.destination.split(" - ")[0]}</span>
                    <span className="text-[10px]">(±{activeFilter.radius}km)</span>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive" onClick={clearFilter}>
                    <X className="h-3 w-3 mr-0.5" /> Limpar
                  </Button>
                </div>
                {activeFilter.distanceKm > 0 && (
                  <div className="flex gap-3 text-[11px]">
                    <div className="flex items-center gap-1.5 bg-background rounded px-2 py-1 border">
                      <span>🚗</span>
                      <span className="text-muted-foreground">Ida:</span>
                      <span className="font-medium">{Math.round(activeFilter.distanceKm)} km</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-medium">
                        {activeFilter.durationMin >= 60
                          ? `${Math.floor(activeFilter.durationMin / 60)}h${Math.round(activeFilter.durationMin % 60).toString().padStart(2, "0")}`
                          : `${Math.round(activeFilter.durationMin)} min`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-background rounded px-2 py-1 border">
                      <span>🔄</span>
                      <span className="text-muted-foreground">Ida+Volta:</span>
                      <span className="font-medium">{Math.round(activeFilter.distanceKm * 2)} km</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-medium">
                        {(() => {
                          const totalMin = activeFilter.durationMin * 2;
                          return totalMin >= 60
                            ? `${Math.floor(totalMin / 60)}h${Math.round(totalMin % 60).toString().padStart(2, "0")}`
                            : `${Math.round(totalMin)} min`;
                        })()}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* City list */}
              <ScrollArea className="max-h-[200px]">
                <div className="divide-y">
                  {activeFilter.matchedCities
                    .sort((a, b) => (cityCounts.get(b) || 0) - (cityCounts.get(a) || 0))
                    .map((c) => (
                    <div key={c} className="flex items-center justify-between px-4 py-1.5 hover:bg-muted/40 group">
                      <div className="flex items-center gap-2 min-w-0">
                        <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs truncate">{c}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono">
                          {cityCounts.get(c) || 0}
                        </Badge>
                        <button
                          className="h-4 w-4 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/20 transition-opacity"
                          onClick={() => excludeCity(c)}
                          title={`Remover ${c}`}
                        >
                          <X className="h-2.5 w-2.5 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Footer actions */}
              <div className="px-4 py-2.5 border-t bg-muted/20 flex gap-2">
                {onShowMap && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs h-7"
                    onClick={() => {
                      setOpen(false);
                      onShowMap();
                    }}
                  >
                    <MapIcon className="h-3.5 w-3.5" />
                    Ver no Mapa
                  </Button>
                )}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
