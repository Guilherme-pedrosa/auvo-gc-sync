export interface AgendaTagVisual {
  id: string;
  name: string;
  color: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeAgendaTagColor(color: string | null | undefined) {
  const normalized = String(color || "").trim().toUpperCase();
  return HEX_COLOR.test(normalized) ? normalized : "#2563EB";
}

export function agendaTagTextColor(color: string | null | undefined) {
  const hex = normalizeAgendaTagColor(color).slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance >= 150 ? "#111827" : "#FFFFFF";
}

export function agendaMatchesTagFilter(
  itemTags: ReadonlyArray<Pick<AgendaTagVisual, "id">>,
  selectedTagIds: ReadonlyArray<string>,
) {
  if (selectedTagIds.length === 0) return true;
  const itemTagIds = new Set(itemTags.map((tag) => tag.id));
  return selectedTagIds.some((tagId) => itemTagIds.has(tagId));
}
