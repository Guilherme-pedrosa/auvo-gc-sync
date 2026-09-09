// Paginação segura para consultas da agenda: o PostgREST limita cada resposta,
// então varremos em lotes até esgotar as linhas.

const PAGE_SIZE = 1000;
const MAX_PAGES = 60;

type PageResult<T> = { data: T[] | null; error: { message?: string } | null };

export async function fetchAgendaPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message || "Falha ao carregar a agenda");
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}
