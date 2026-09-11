export type AuvoTask = { taskID?: string | number; [key: string]: any };

export type AuvoTaskFetchWindow = {
  startDate: string;
  endDate: string;
  complete: boolean;
  error?: string;
};

export type AuvoTaskFetchResult = {
  tasks: AuvoTask[];
  completeTasks: AuvoTask[];
  complete: boolean;
  windows: AuvoTaskFetchWindow[];
};

type FetchPage = (date: string, page: number) => Promise<Response>;
type Options = {
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const MAX_ATTEMPTS = 3;

async function fetchDay(fetchPage: FetchPage, date: string, options: Required<Options>) {
  const tasks: AuvoTask[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let response: Response | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        response = await fetchPage(date, page);
      } catch {
        response = undefined;
      }
      const retryable = !response || [404, 429, 500, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      // Empty/future days may consistently return 404; keep this retry short.
      const wait = attempt * (response?.status === 404 ? 500 : 3000);
      options.log(`Auvo ${date} página ${page}: HTTP ${response?.status ?? "sem resposta"}, tentativa ${attempt}/${MAX_ATTEMPTS}; repetindo em ${wait}ms`);
      await response?.body?.cancel().catch(() => undefined);
      await options.sleep(wait);
    }

    if (!response) return { tasks, complete: false, error: `sem resposta na página ${page}` };
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      // A first-page 404 remains ambiguous even after retry. It must never
      // authorize deletion or turn a failed day into a confirmed empty day.
      return page === 1
        ? { tasks, complete: false, error: "primeira página respondeu 404 após 3 tentativas" }
        : { tasks, complete: true };
    }
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel().catch(() => undefined);
      return { tasks, complete: false, error: `página ${page} respondeu ${status}` };
    }

    let json: any;
    try {
      json = await response.json();
    } catch {
      return { tasks, complete: false, error: `página ${page} retornou JSON inválido` };
    }
    // Do not convert a missing/malformed result envelope into an empty list.
    const list = json?.result?.entityList ?? json?.result?.Entities ?? json?.result?.tasks ?? json?.result;
    if (!Array.isArray(list)) {
      return { tasks, complete: false, error: `página ${page} retornou payload inesperado` };
    }
    tasks.push(...list);
    if (list.length < PAGE_SIZE) return { tasks, complete: true };
  }
  return { tasks, complete: false, error: `limite de ${MAX_PAGES} páginas atingido` };
}

// Keep each Auvo request to one day. Complete-day rows are kept separately
// from partial pages so the hourly import can preserve failed days verbatim.
export async function fetchAuvoTaskWindows(
  fetchPage: FetchPage,
  startDate: string,
  endDate: string,
  options: Options = {},
): Promise<AuvoTaskFetchResult> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    throw new Error("Período Auvo inválido");
  }
  const deps = {
    sleep: options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))),
    log: options.log ?? ((message: string) => console.log(`[central-sync] ${message}`)),
  };
  const tasks: AuvoTask[] = [];
  const completeTasks: AuvoTask[] = [];
  const seen = new Set<string>();
  const completeSeen = new Set<string>();
  const windows: AuvoTaskFetchWindow[] = [];
  for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    const date = current.toISOString().slice(0, 10);
    const result = await fetchDay(fetchPage, date, deps);
    windows.push({ startDate: date, endDate: date, complete: result.complete, error: result.error });
    for (const task of result.tasks) {
      const id = String(task?.taskID ?? "").trim();
      if (!id || !seen.has(id)) {
        tasks.push(task);
        if (id) seen.add(id);
      }
      if (result.complete && (!id || !completeSeen.has(id))) {
        completeTasks.push(task);
        if (id) completeSeen.add(id);
      }
    }
    deps.log(`Janela ${date}: ${result.tasks.length} tarefas; completa=${result.complete}${result.error ? `; ${result.error}` : ""}`);
  }
  return { tasks, completeTasks, windows, complete: windows.length > 0 && windows.every(window => window.complete) };
}
