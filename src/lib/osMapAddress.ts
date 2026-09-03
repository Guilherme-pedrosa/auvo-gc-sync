import { normalizeClientName } from "@/lib/clientMatching";

export type MapAddressSource = "tarefa_auvo" | "rh_clientes" | "ausente";

export type MapAddressResolution = {
  address: string | null;
  source: MapAddressSource;
  clientId: string | null;
  issue: string | null;
};

export type OSMapAddressItem = {
  endereco?: string | null;
  cliente?: string | null;
  gc_os_cliente?: string | null;
};

export type RhClientMapRow = {
  id: string;
  nome: string | null;
  nome_gc: string | null;
  nome_auvo: string | null;
  nome_fantasia: string | null;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  vinculo_status: string | null;
  ativo?: boolean | null;
};

type IndexedClient = RhClientMapRow & {
  auvoNames: Set<string>;
  gcNames: Set<string>;
  allNames: Set<string>;
};

export type RhClientAddressIndex = {
  rows: IndexedClient[];
  byAnyName: Map<string, IndexedClient[]>;
};

function clean(value: string | null | undefined): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedNames(values: (string | null | undefined)[]): Set<string> {
  return new Set(values.map(normalizeClientName).filter(Boolean));
}

function hasText(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeClientName(needle);
  return !!normalizedNeedle && normalizeClientName(haystack).includes(normalizedNeedle);
}

/**
 * Monta um endereço geocodificável sem inventar rua ou número. O cadastro do
 * GC guarda logradouro/bairro em `endereco` e cidade/UF/CEP em colunas próprias.
 */
export function formatRhClientAddress(row: RhClientMapRow): string | null {
  const street = clean(row.endereco);
  if (street.length < 5) return null;

  const parts = [street];
  const city = clean(row.cidade);
  const uf = clean(row.uf).toUpperCase();
  const cepDigits = clean(row.cep).replace(/\D/g, "");
  const cityUf = [city, uf].filter(Boolean).join(" - ");

  const alreadyHasCity = !!city && hasText(street, city);
  const alreadyHasUf = !!uf && new RegExp(`(?:^|[\\s,/-])${uf}(?:$|[\\s,/-])`, "i").test(street);
  if (cityUf && !(alreadyHasCity && (!uf || alreadyHasUf))) parts.push(cityUf);
  if (cepDigits.length === 8 && !street.replace(/\D/g, "").includes(cepDigits)) {
    parts.push(`${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}`);
  }
  if (!/\bbrasil\b/i.test(street)) parts.push("Brasil");

  return parts.filter(Boolean).join(", ");
}

export function buildRhClientAddressIndex(rows: RhClientMapRow[]): RhClientAddressIndex {
  const indexedRows: IndexedClient[] = rows
    .filter((row) => row.ativo !== false)
    .map((row) => {
      const auvoNames = normalizedNames([row.nome_auvo]);
      const gcNames = normalizedNames([row.nome_gc, row.nome, row.nome_fantasia]);
      return {
        ...row,
        auvoNames,
        gcNames,
        allNames: new Set([...auvoNames, ...gcNames]),
      };
    });

  const byAnyName = new Map<string, IndexedClient[]>();
  for (const row of indexedRows) {
    for (const name of row.allNames) {
      const bucket = byAnyName.get(name) || [];
      bucket.push(row);
      byAnyName.set(name, bucket);
    }
  }

  return { rows: indexedRows, byAnyName };
}

function chooseOfficialClient(
  item: OSMapAddressItem,
  index: RhClientAddressIndex,
): IndexedClient | null {
  const auvoName = normalizeClientName(item.cliente);
  const gcName = normalizeClientName(item.gc_os_cliente);
  const candidateMap = new Map<string, IndexedClient>();

  for (const key of [auvoName, gcName].filter(Boolean)) {
    for (const candidate of index.byAnyName.get(key) || []) candidateMap.set(candidate.id, candidate);
  }

  const ranked = [...candidateMap.values()].map((row) => {
    const isOfficial = String(row.vinculo_status || "").toLowerCase() === "vinculado";
    const auvoExact = !!auvoName && row.auvoNames.has(auvoName);
    const gcExact = !!gcName && row.gcNames.has(gcName);
    const anyAuvo = !!auvoName && row.allNames.has(auvoName);
    const anyGc = !!gcName && row.allNames.has(gcName);
    const pairExact = auvoExact && gcExact;
    const score =
      (pairExact ? 100 : 0)
      + (isOfficial ? 30 : 0)
      + (auvoExact ? 12 : anyAuvo ? 4 : 0)
      + (gcExact ? 12 : anyGc ? 4 : 0)
      + (formatRhClientAddress(row) ? 2 : 0);
    return { row, score, pairExact, isOfficial };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  // Quando ambos os nomes existem, só aceitamos o par oficial da mesma linha.
  // Isso impede usar o endereço de outra unidade com nome parecido.
  if (auvoName && gcName) {
    if (best.pairExact) return best.row;
    if (!best.isOfficial) return null;
    const matchesBoth = best.row.allNames.has(auvoName) && best.row.allNames.has(gcName);
    return matchesBoth ? best.row : null;
  }

  return best.isOfficial || best.score >= 12 ? best.row : null;
}

export function resolveOSMapAddress(
  item: OSMapAddressItem,
  index: RhClientAddressIndex,
): MapAddressResolution {
  const taskAddress = clean(item.endereco);
  if (taskAddress.length > 5) {
    return {
      address: taskAddress,
      source: "tarefa_auvo",
      clientId: null,
      issue: null,
    };
  }

  const client = chooseOfficialClient(item, index);
  if (!client) {
    return {
      address: null,
      source: "ausente",
      clientId: null,
      issue: "Cliente sem vínculo correspondente em RH > Clientes",
    };
  }

  const address = formatRhClientAddress(client);
  if (!address) {
    return {
      address: null,
      source: "ausente",
      clientId: client.id,
      issue: "Cliente vinculado, mas sem rua/número no cadastro RH > Clientes",
    };
  }

  return {
    address,
    source: "rh_clientes",
    clientId: client.id,
    issue: null,
  };
}
