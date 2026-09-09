type PageOptions = {
  url: string;
  headers: Record<string, string>;
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  ingest: (records: any[]) => void;
  sleep?: (ms: number) => Promise<void>;
};

/** A partial collection must never replace the last successful Kanban snapshot. */
export async function fetchCompleteGcCollection(options: PageOptions): Promise<void> {
  const pause = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const base = new URL(options.url);
  const fetchPage = async (page: number) => {
    const url = new URL(base);
    url.searchParams.set("pagina", String(page));
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await options.fetcher(url.toString(), { headers: options.headers });
      if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
        await response.body?.cancel();
        await pause(attempt === 0 ? 5000 : 10000);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`GC ${base.pathname}, página ${page}: HTTP ${response.status}. Sincronização incompleta; cache anterior preservado.`);
      }
      let data: any;
      try { data = await response.json(); }
      catch { throw new Error(`GC ${base.pathname}, página ${page}: resposta JSON inválida; cache anterior preservado.`); }
      const totalPages = Number(data?.meta?.total_paginas ?? 1);
      // Some GC collections report zero pages when empty. Any other invalid
      // count is an error, rather than an apparently successful empty import.
      const empty = Array.isArray(data?.data) && data.data.length === 0;
      if (!Array.isArray(data?.data) || !Number.isSafeInteger(totalPages) || totalPages < 0 || (totalPages === 0 && !empty)) {
        throw new Error(`GC ${base.pathname}, página ${page}: coleção ou paginação inválida; cache anterior preservado.`);
      }
      return { records: data.data, totalPages: Math.max(1, totalPages) };
    }
    throw new Error(`GC ${base.pathname}, página ${page}: tentativas esgotadas; cache anterior preservado.`);
  };

  const first = await fetchPage(1);
  options.ingest(first.records);
  // Budget and OS collections run together: two pages each avoids the former
  // burst of ten requests while retaining the shared broker's global limiter.
  const concurrency = 2;
  for (let start = 2; start <= first.totalPages; start += concurrency) {
    const pages = Array.from({ length: Math.min(concurrency, first.totalPages - start + 1) }, (_, i) => start + i);
    const results = await Promise.all(pages.map(fetchPage));
    for (const result of results) options.ingest(result.records);
  }
}
