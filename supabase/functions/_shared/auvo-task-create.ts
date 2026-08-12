export type TaskLocation = {
  address: string;
  source: "auvo" | "rh_clientes";
  latitude?: number;
  longitude?: number;
};

export type RhCustomerAddress = {
  endereco?: unknown;
  cidade?: unknown;
  uf?: unknown;
  cep?: unknown;
} | null | undefined;

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function positiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || cleanText(value) === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeChoice(
  value: unknown,
  allowed: readonly number[],
): number | null {
  const parsed = positiveInteger(value);
  return parsed !== null && allowed.includes(parsed) ? parsed : null;
}

export function buildAuvoTaskDate(dateISO: unknown, startTime: unknown): string | null {
  const date = cleanText(dateISO);
  const time = cleanText(startTime);
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) return null;

  return `${date}T${time}:00`;
}

function validCoordinates(latitude: unknown, longitude: unknown) {
  if (
    latitude === null || latitude === undefined || cleanText(latitude) === "" ||
    longitude === null || longitude === undefined || cleanText(longitude) === ""
  ) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

function rhAddress(customer: RhCustomerAddress): string {
  if (!customer) return "";
  const cityState = [cleanText(customer.cidade), cleanText(customer.uf)]
    .filter(Boolean)
    .join("/");
  return [cleanText(customer.endereco), cityState, cleanText(customer.cep)]
    .filter(Boolean)
    .join(", ");
}

export function resolveTaskLocation(
  auvoCustomer: Record<string, unknown> | null | undefined,
  fallbackCustomer?: RhCustomerAddress,
): TaskLocation | null {
  const auvoAddress = cleanText(
    auvoCustomer?.address ??
    auvoCustomer?.endereco ??
    auvoCustomer?.streetAddress,
  );
  const coordinates = validCoordinates(
    auvoCustomer?.latitude,
    auvoCustomer?.longitude,
  );

  if (auvoAddress) {
    return {
      address: auvoAddress,
      source: "auvo",
      ...(coordinates || {}),
    };
  }

  const fallbackAddress = rhAddress(fallbackCustomer);
  if (!fallbackAddress) return null;
  return { address: fallbackAddress, source: "rh_clientes" };
}

function flattenError(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(flattenError);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(flattenError);
  }
  const text = cleanText(value);
  return text ? [text] : [];
}

export function extractAuvoError(data: unknown, status: number): string {
  const body = data && typeof data === "object"
    ? data as Record<string, unknown>
    : { raw: data };
  const candidates = [body.Message, body.message, body.error, body.errors, body.raw];
  const message = candidates.flatMap(flattenError).find(Boolean);
  return message || `HTTP ${status}`;
}
