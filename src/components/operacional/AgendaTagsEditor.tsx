import { useMemo, useState } from "react";
import { Check, Plus, Tags, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAgendaTagLinks,
  useAgendaTags,
  useCreateAgendaTag,
  useSetAgendaTags,
} from "@/hooks/operacional/useAgendaTags";
import { agendaTagTextColor, normalizeAgendaTagColor } from "@/lib/agendaTags";

interface AgendaTagsEditorProps {
  agendamentoId: string | null | undefined;
}

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

export default function AgendaTagsEditor({ agendamentoId }: AgendaTagsEditorProps) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#2563EB");
  const { data: tags = [], isLoading: loadingTags } = useAgendaTags(!!agendamentoId);
  const { data: links = [], isLoading: loadingLinks } = useAgendaTagLinks(
    agendamentoId ? [agendamentoId] : [],
    !!agendamentoId,
  );
  const createTag = useCreateAgendaTag();
  const setTags = useSetAgendaTags();

  const selectedIds = useMemo(
    () => links.filter((link) => link.agendamento_id === agendamentoId).map((link) => link.tag_id),
    [agendamentoId, links],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTags = tags.filter((tag) => selectedSet.has(tag.id));
  const busy = createTag.isPending || setTags.isPending;

  if (!agendamentoId) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        Salve o agendamento primeiro para adicionar tags.
      </div>
    );
  }

  const persist = async (nextIds: string[]) => {
    try {
      await setTags.mutateAsync({ agendamentoId, tagIds: nextIds });
    } catch (error: unknown) {
      toast.error(errorMessage(error) || "Não foi possível atualizar as tags.");
    }
  };

  const toggleTag = (tagId: string, checked: boolean) => {
    const nextIds = checked
      ? [...selectedIds, tagId]
      : selectedIds.filter((id) => id !== tagId);
    void persist(nextIds);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Informe o nome da tag.");
      return;
    }
    try {
      const created = await createTag.mutateAsync({ name, color: newColor });
      await setTags.mutateAsync({ agendamentoId, tagIds: [...selectedIds, created.id] });
      setNewName("");
      toast.success(`Tag ${created.name} criada e vinculada.`);
    } catch (error: unknown) {
      const message = errorMessage(error);
      const duplicate = message.toLowerCase().includes("duplicate");
      toast.error(duplicate ? "Já existe uma tag com esse nome." : message || "Não foi possível criar a tag.");
    }
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-xs font-bold">
          <Tags className="h-4 w-4 text-primary" /> Tags / Etiquetas
        </Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-2" disabled={busy || loadingTags || loadingLinks}>
              <Check className="h-3.5 w-3.5" /> Selecionar ({selectedIds.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-64 w-64 overflow-y-auto">
            <DropdownMenuLabel>Vincular tags ao item</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {tags.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag.id}
                checked={selectedSet.has(tag.id)}
                disabled={busy}
                onCheckedChange={(checked) => toggleTag(tag.id, checked === true)}
                onSelect={(event) => event.preventDefault()}
              >
                <span className="mr-2 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: normalizeAgendaTagColor(tag.color) }} />
                <span className="truncate">{tag.name}</span>
              </DropdownMenuCheckboxItem>
            ))}
            {tags.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground">Nenhuma tag cadastrada.</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-6 flex-wrap gap-1.5">
        {selectedTags.map((tag) => {
          const color = normalizeAgendaTagColor(tag.color);
          return (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold"
              style={{ backgroundColor: color, color: agendaTagTextColor(color) }}
            >
              {tag.name}
              <button
                type="button"
                className="rounded-full opacity-75 hover:opacity-100"
                title={`Desvincular ${tag.name}`}
                onClick={() => toggleTag(tag.id, false)}
                disabled={busy}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        {!loadingLinks && selectedTags.length === 0 && (
          <span className="text-xs text-muted-foreground">Nenhuma tag vinculada.</span>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_3rem_auto] gap-2">
        <Input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Nova tag (ex.: Rota 01)"
          maxLength={60}
          className="h-9"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleCreate();
            }
          }}
        />
        <Input
          type="color"
          value={normalizeAgendaTagColor(newColor)}
          onChange={(event) => setNewColor(event.target.value)}
          className="h-9 cursor-pointer p-1"
          aria-label="Cor da nova tag"
        />
        <Button type="button" size="sm" className="h-9 gap-1" onClick={handleCreate} disabled={busy || !newName.trim()}>
          <Plus className="h-3.5 w-3.5" /> Criar
        </Button>
      </div>
    </div>
  );
}
