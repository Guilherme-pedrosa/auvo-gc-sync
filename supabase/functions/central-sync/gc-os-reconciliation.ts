export type GcOsReconciliationWarning = {
  os_id: string;
  status: number | null;
  message: string;
};

type GcOsReadResult =
  | { kind: "confirmed"; os: any }
  | { kind: "missing" }
  | { kind: "unavailable"; warning: GcOsReconciliationWarning };

function providerMessage(payload: any): string {
  const values = [payload?.data?.mensagem, payload?.data?.message, payload?.mensagem, payload?.message];
  const message = values.find(value => typeof value === "string" && value.trim());
  return typeof message === "string" ? message.replace(/\s+/g, " ").trim().slice(0, 240) : "";
}

// GC also uses HTTP 400 for permission failures. A failed read or an empty
// success response is not evidence that a business document was deleted.
export async function readGcOsForReconciliation(
  id: string,
  getOs: (id: string) => Promise<Response>,
): Promise<GcOsReadResult> {
  let response: Response;
  try {
    response = await getOs(id);
  } catch {
    return { kind: "unavailable", warning: {
      os_id: id, status: null,
      message: `OS ${id}: consulta ao GestãoClick indisponível. Registro preservado.`,
    } };
  }
  if ([404, 410].includes(response.status)) return { kind: "missing" };
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = providerMessage(payload);
    return { kind: "unavailable", warning: {
      os_id: id, status: response.status,
      message: `OS ${id}: HTTP ${response.status}${detail ? ` — ${detail}` : ""}. Registro preservado.`,
    } };
  }
  const os = payload?.data || payload;
  if (String(os?.id || "") !== id) {
    return { kind: "unavailable", warning: {
      os_id: id, status: response.status,
      message: `OS ${id}: resposta sem confirmação da identidade do pedido. Registro preservado.`,
    } };
  }
  return { kind: "confirmed", os };
}
