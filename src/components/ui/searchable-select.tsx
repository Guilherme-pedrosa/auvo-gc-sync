import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectBaseProps {
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  icon?: React.ReactNode;
}

interface SingleSelectProps extends SearchableSelectBaseProps {
  multiple?: false;
  value: string;
  onValueChange: (value: string) => void;
}

interface MultiSelectProps extends SearchableSelectBaseProps {
  multiple: true;
  value: string[];
  onValueChange: (value: string[]) => void;
}

type SearchableSelectProps = SingleSelectProps | MultiSelectProps;


const normalize = (v: string) =>
  v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Filtra por substring: todos os termos digitados precisam estar no rótulo. */
function useFilteredOptions(options: SearchableSelectOption[], search: string) {
  return React.useMemo(() => {
    const terms = normalize(search).split(/\s+/).filter(Boolean);
    if (!terms.length) return options;
    const scored = options
      .map((o) => {
        const label = normalize(o.label);
        if (!terms.every((t) => label.includes(t))) return null;
        const idx = label.indexOf(terms[0]);
        return { o, score: (label.startsWith(terms[0]) ? 0 : 1) * 1000 + idx };
      })
      .filter(Boolean) as { o: SearchableSelectOption; score: number }[];
    scored.sort((a, b) => a.score - b.score || a.o.label.localeCompare(b.o.label));
    return scored.map((s) => s.o);
  }, [options, search]);
}

export function SearchableSelect(props: SearchableSelectProps) {
  const {
    options,
    placeholder = "Selecionar...",
    searchPlaceholder = "Buscar...",
    emptyText = "Nenhum resultado.",
    className,
    icon,
    multiple,
  } = props;

  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const filtered = useFilteredOptions(options, search);

  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  if (multiple) {
    const { value, onValueChange } = props as MultiSelectProps;

    const handleToggle = (optValue: string) => {
      if (value.includes(optValue)) {
        onValueChange(value.filter((v) => v !== optValue));
      } else {
        onValueChange([...value, optValue]);
      }
    };

    const selectedLabels = value
      .map((v) => options.find((o) => o.value === v)?.label)
      .filter(Boolean) as string[];

    const displayText =
      selectedLabels.length === 0
        ? placeholder
        : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} selecionados`;

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("justify-between font-normal", className)}
          >
            <span className="flex items-center gap-1 truncate">
              {icon}
              <span className="truncate">{displayText}</span>
            </span>
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[280px] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
            <CommandList className="max-h-72">
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {filtered.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => handleToggle(option.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value.includes(option.value) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          {value.length > 0 && (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => { onValueChange([]); setOpen(false); }}
              >
                <X className="h-3 w-3 mr-1" /> Limpar seleção
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  // Single select (original behavior)
  const { value, onValueChange } = props as SingleSelectProps;
  const selectedOption = options.find((o) => o.value === value);
  const selectedLabel = selectedOption?.label || placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal", className)}
        >
          <span className="flex items-center gap-1 truncate w-full">
            {icon}
            <span className="truncate flex-1 text-left">{selectedLabel}</span>
            {value && (
              <span
                role="button"
                tabIndex={0}
                aria-label="Limpar seleção"
                className="shrink-0 ml-1 opacity-50 hover:opacity-100 cursor-pointer"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onValueChange("");
                  setOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onValueChange("");
                    setOpen(false);
                  }
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {value && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => { onValueChange(""); setOpen(false); }}
            >
              <X className="h-3 w-3 mr-1" /> Limpar filtro
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
