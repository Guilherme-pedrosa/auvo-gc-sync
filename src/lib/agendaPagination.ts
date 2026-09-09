const AGENDA_PAGE_SIZE = 500;

/** The query must order by a unique key so adjacent pages cannot overlap. */
export async function fetchAgendaPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += AGENDA_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + AGENDA_PAGE_SIZE - 1);
    if (error) throw new Error(error.message || "Falha ao carregar a agenda");
    const page = data ?? [];
    rows.push(...page);
    if (page.length < AGENDA_PAGE_SIZE) return rows;
  }
}
