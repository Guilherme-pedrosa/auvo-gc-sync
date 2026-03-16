import { useState, useCallback, useMemo, memo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Navigation, Search } from "lucide-react";

interface Props {
  allCities: string[];
  cityColorMap: Map<string, { bg: string; text: string }>;
  cityCounts: Map<string, number>;
  selectedFlags: Set<string>;
  allFlagsSelected: boolean;
  filterOnlyRoutes: boolean;
  onApply: (flags: Set<string>, allSelected: boolean, onlyRoutes: boolean) => void;
  onRoteirizar: () => void;
}

const CityRow = memo(({
  city, color, count, checked, onToggle,
}: {
  city: string;
  color?: { bg: string };
  count: number;
  checked: boolean;
  onToggle: (city: string) => void;
}) => (
  <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-accent rounded text-sm">
    <Checkbox checked={checked} onCheckedChange={() => onToggle(city)} />
    <span
      className="w-3 h-3 rounded-full flex-shrink-0 border"
      style={{ backgroundColor: color?.bg || "#6b7280" }}
    />
    <span className="truncate flex-1">{city}</span>
    <span className="text-xs text-muted-foreground">{count}</span>
  </label>
));
CityRow.displayName = "CityRow";

export default function FlagFilterPopover({
  allCities, cityColorMap, cityCounts,
  selectedFlags, allFlagsSelected, filterOnlyRoutes,
  onApply, onRoteirizar,
}: Props) {
  const [open, setOpen] = useState(false);
  const [localFlags, setLocalFlags] = useState<Set<string>>(new Set());
  const [localAll, setLocalAll] = useState(true);
  const [localOnlyRoutes, setLocalOnlyRoutes] = useState(false);
  const [search, setSearch] = useState("");

  // Sync local state when popover opens
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setLocalFlags(new Set(selectedFlags));
      setLocalAll(allFlagsSelected);
      setLocalOnlyRoutes(filterOnlyRoutes);
      setSearch("");
    } else {
      // Apply on close
      onApply(localFlags, localAll, localOnlyRoutes);
    }
    setOpen(nextOpen);
  }, [selectedFlags, allFlagsSelected, filterOnlyRoutes, onApply, localFlags, localAll, localOnlyRoutes]);

  const toggleCity = useCallback((city: string) => {
    setLocalFlags((prev) => {
      const next = new Set(prev);
      if (next.has(city)) next.delete(city);
      else next.add(city);
      return next;
    });
    setLocalAll(false);
  }, []);

  const toggleAll = useCallback(() => {
    if (localAll) {
      setLocalFlags(new Set());
      setLocalAll(false);
    } else {
      setLocalFlags(new Set(allCities));
      setLocalAll(true);
    }
  }, [localAll, allCities]);

  const filteredCities = useMemo(() => {
    if (!search.trim()) return allCities;
    const term = search.toLowerCase();
    return allCities.filter((c) => c.toLowerCase().includes(term));
  }, [allCities, search]);

  const activeCount = allFlagsSelected ? 0 : selectedFlags.size;
  const localActiveCount = localAll ? 0 : localFlags.size;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 min-w-[160px] justify-start">
          🚩 Flags
          {activeCount > 0 && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1 ml-1">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="p-2 border-b space-y-1">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar cidade..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs pl-7"
            />
          </div>
          <label className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-accent rounded text-sm">
            <Checkbox checked={localAll} onCheckedChange={toggleAll} />
            <span className="font-medium">Todas as cidades</span>
          </label>
          <label className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-accent rounded text-sm">
            <Checkbox
              checked={localOnlyRoutes}
              onCheckedChange={(v) => setLocalOnlyRoutes(!!v)}
            />
            <span className="font-medium">🔗 Apenas com rota</span>
          </label>
        </div>
        <ScrollArea className="max-h-[300px]">
          <div className="p-2 space-y-0.5">
            {filteredCities.map((city) => (
              <CityRow
                key={city}
                city={city}
                color={cityColorMap.get(city)}
                count={cityCounts.get(city) || 0}
                checked={localAll || localFlags.has(city)}
                onToggle={toggleCity}
              />
            ))}
            {filteredCities.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma cidade encontrada</p>
            )}
          </div>
        </ScrollArea>
        {localActiveCount > 0 && (
          <div className="p-2 border-t">
            <Button
              size="sm"
              className="w-full gap-2"
              onClick={() => {
                onApply(localFlags, localAll, localOnlyRoutes);
                setOpen(false);
                onRoteirizar();
              }}
            >
              <Navigation className="h-3.5 w-3.5" />
              Roteirizar {localActiveCount} cidade{localActiveCount !== 1 ? "s" : ""} selecionada{localActiveCount !== 1 ? "s" : ""}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
