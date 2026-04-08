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
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
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
  const selectedLabel = options.find((o) => o.value === value)?.label || placeholder;

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
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
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
      </PopoverContent>
    </Popover>
  );
}
