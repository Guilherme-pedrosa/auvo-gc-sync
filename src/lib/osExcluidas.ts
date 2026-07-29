/**
 * Controle de OS excluídas no GestãoClick.
 * Uma OS apagada no GC continua espelhada localmente até o próximo sync;
 * marcamos como situação "EXCLUÍDA NO GC" para o usuário ver ou remover da lista.
 */
const DETECTED_KEY = "os-excluidas-detectadas";
const REMOVED_KEY = "os-excluidas-removidas";

export const SITUACAO_EXCLUIDA = "EXCLUÍDA NO GC";

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, value: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(value)));
  } catch {
    /* storage indisponível */
  }
}

export const loadDeletedOsIds = () => readSet(DETECTED_KEY);
export const saveDeletedOsIds = (ids: Set<string>) => writeSet(DETECTED_KEY, ids);
export const loadRemovedOsIds = () => readSet(REMOVED_KEY);
export const saveRemovedOsIds = (ids: Set<string>) => writeSet(REMOVED_KEY, ids);

/** Detecta resposta do gc-proxy indicando OS inexistente/apagada no GC. */
export function isGcOsMissingResponse(payload: any): boolean {
  const status = Number(payload?.status ?? payload?.data?.status ?? 0);
  if (status === 404 || status === 410) return true;
  const body = payload?.data ?? payload;
  const code = String(body?.code ?? body?.codigo ?? "");
  if (code === "404") return true;
  const msg = String(body?.mensagem ?? body?.message ?? body?.data?.mensagem ?? "").toLowerCase();
  if (!msg) return false;
  return /n[ãa]o (foi )?(encontrad|localizad)/.test(msg) || msg.includes("not found");
}
