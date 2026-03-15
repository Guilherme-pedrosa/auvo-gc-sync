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

interface RouteCorridorFilterProps {
  allCities: string[];
  cityMap: Map<string, string>; // taskId → city/region
  osItems?: OSInfo[];
  onFilterChange: (matchingTaskIds: Set<string> | null) => void;
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

// Minimum distance from a point to any point on a polyline (sampled)
function minDistToPolyline(
  lat: number,
  lng: number,
  polylinePoints: { lat: number; lng: number }[],
): number {
  let min = Infinity;
  for (const p of polylinePoints) {
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (d < min) min = d;
  }
  return min;
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

      setActiveFilter({
        origin,
        destination,
        radius: radiusKm,
        matchCount: matchingIds.size,
        totalCities: cityList.length,
        matchedCities,
      });

      onFilterChange(matchingIds);
      setOpen(false);
      toast.success(
        `${matchedCities.length} cidade${matchedCities.length !== 1 ? "s" : ""} no corredor (${matchingIds.size} OS)`,
      );
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, radiusKm, cityMap, onFilterChange]);

  const clearFilter = useCallback(() => {
    setActiveFilter(null);
    onFilterChange(null);
  }, [onFilterChange]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant={activeFilter ? "default" : "outline"}
            size="sm"
            className="gap-2 min-w-[160px] justify-start"
          >
            <Route className="h-4 w-4" />
            {activeFilter
              ? `🛤️ ${activeFilter.matchedCities.length} cidades no caminho`
              : "🛤️ Corredor de Rota"}
            {activeFilter && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">
                {activeFilter.matchCount} OS
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[380px] p-4" align="start">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold mb-1">🛤️ Corredor de Rota</p>
              <p className="text-xs text-muted-foreground">
                Encontre OS que ficam no caminho entre duas cidades
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Origem</Label>
              <Select value={origin} onValueChange={setOrigin}>
                <SelectTrigger className="h-8 text-sm">
                  <MapPin className="h-3 w-3 mr-1 text-green-500" />
                  <SelectValue placeholder="Selecione a origem" />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_ORIGINS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                  {allCities
                    .filter((c) => !PRESET_ORIGINS.includes(c))
                    .map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Destino</Label>
              <DestinationAutocomplete
                value={destination}
                onChange={setDestination}
                allCities={allCities}
                osItems={osItems}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Raio de desvio</Label>
                <span className="text-xs font-mono text-muted-foreground">{radiusKm} km</span>
              </div>
              <Slider
                value={[radiusKm]}
                onValueChange={([v]) => setRadiusKm(v)}
                min={10}
                max={200}
                step={10}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>10km</span>
                <span>100km</span>
                <span>200km</span>
              </div>
            </div>

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

            {activeFilter && (
              <div className="border rounded-md p-2.5 bg-muted/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">Filtro ativo</p>
                  <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={clearFilter}>
                    <X className="h-3 w-3 mr-0.5" /> Limpar
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {activeFilter.origin} → {activeFilter.destination} (±{activeFilter.radius}km)
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {activeFilter.matchedCities.map((c) => (
                    <Badge key={c} variant="secondary" className="text-[10px] h-4 px-1.5">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
