export function agendaDateIsInRange(date: string, firstDate: string, lastDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < firstDate || date > lastDate) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** Alinha a coluna escolhida depois da coluna fixa de técnico/veículo. */
export function scrollAgendaToDate(date: string, behavior: ScrollBehavior = "auto", scope: ParentNode = document) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  scope.querySelectorAll<HTMLElement>(`[data-agenda-date="${date}"]`).forEach((header) => {
    const container = header.closest<HTMLElement>("[data-agenda-scroll='1']");
    if (!container || !container.getBoundingClientRect().width) return;
    const personWidth = container.querySelector<HTMLElement>("thead th")?.getBoundingClientRect().width ?? 0;
    const left = container.scrollLeft + header.getBoundingClientRect().left
      - container.getBoundingClientRect().left - container.clientLeft - personWidth;
    container.scrollTo({ left: Math.max(0, left), behavior });
  });
}
