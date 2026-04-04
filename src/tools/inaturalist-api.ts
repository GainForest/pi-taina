const INAT_API_BASE = 'https://api.inaturalist.org/v1';
const USER_AGENT = 'Pi-Taina/1.0 (biodiversity-bot)';
const TIMEOUT_MS = 10_000;

// ─── Exported interfaces ────────────────────────────────────────────────────

export interface INatTaxon {
  id: number;
  name: string;                    // scientific name
  preferredCommonName: string | null;
  rank: string;
  observationsCount: number;
  wikipediaUrl: string | null;
  defaultPhoto: { mediumUrl: string; attribution: string } | null;
  iconicTaxonName: string | null;  // e.g. 'Aves', 'Plantae'
  threatened: boolean;
  conservationStatus: {
    status: string;       // e.g. 'cr', 'en', 'vu', 'nt', 'lc'
    authority: string;    // e.g. 'IUCN Red List'
    iucnCode: number;     // numeric IUCN equivalent
  } | null;
  ancestorNames: string[];  // extracted from ancestors[].name if present
}

export interface INatTaxonResult {
  success: true;
  taxa: INatTaxon[];
  totalResults: number;
}

export interface INatError {
  success: false;
  error: string;
}

export interface INatSpeciesCount {
  count: number;
  taxon: INatTaxon;
}

export interface INatSpeciesCountResult {
  success: true;
  species: INatSpeciesCount[];
  totalResults: number;
}

// ─── Raw API response types (internal) ──────────────────────────────────────

interface RawConservationStatus {
  status: string;
  authority: string;
  iucn: number;
}

interface RawDefaultPhoto {
  medium_url: string;
  attribution: string;
}

interface RawAncestor {
  name: string;
}

interface RawTaxon {
  id: number;
  name: string;
  preferred_common_name?: string;
  rank: string;
  observations_count: number;
  wikipedia_url?: string;
  default_photo?: RawDefaultPhoto;
  iconic_taxon_name?: string;
  threatened: boolean;
  conservation_status?: RawConservationStatus;
  ancestors?: RawAncestor[];
}

interface RawTaxaResponse {
  total_results: number;
  results: RawTaxon[];
}

interface RawSpeciesCountEntry {
  count: number;
  taxon: RawTaxon;
}

interface RawSpeciesCountResponse {
  total_results: number;
  results: RawSpeciesCountEntry[];
}

// ─── Mapping helpers ─────────────────────────────────────────────────────────

function mapTaxon(raw: RawTaxon): INatTaxon {
  return {
    id: raw.id,
    name: raw.name,
    preferredCommonName: raw.preferred_common_name ?? null,
    rank: raw.rank,
    observationsCount: raw.observations_count,
    wikipediaUrl: raw.wikipedia_url ?? null,
    defaultPhoto: raw.default_photo
      ? { mediumUrl: raw.default_photo.medium_url, attribution: raw.default_photo.attribution }
      : null,
    iconicTaxonName: raw.iconic_taxon_name ?? null,
    threatened: raw.threatened,
    conservationStatus: raw.conservation_status
      ? {
          status: raw.conservation_status.status,
          authority: raw.conservation_status.authority,
          iucnCode: raw.conservation_status.iucn,
        }
      : null,
    ancestorNames: raw.ancestors?.map((a) => a.name) ?? [],
  };
}

// ─── Exported functions ──────────────────────────────────────────────────────

export async function searchTaxa(
  query: string,
  limit?: number
): Promise<INatTaxonResult | INatError> {
  const url = `${INAT_API_BASE}/taxa?q=${encodeURIComponent(query)}&per_page=${limit ?? 5}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${message}` };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return {
      success: false,
      error: `iNaturalist returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let data: RawTaxaResponse;
  try {
    data = (await response.json()) as RawTaxaResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse response: ${message}` };
  }

  return {
    success: true,
    taxa: data.results.map(mapTaxon),
    totalResults: data.total_results,
  };
}

export async function getSpeciesNearLocation(
  lat: number,
  lng: number,
  radiusKm?: number,
  limit?: number
): Promise<INatSpeciesCountResult | INatError> {
  const url =
    `${INAT_API_BASE}/observations/species_counts` +
    `?lat=${lat}&lng=${lng}&radius=${radiusKm ?? 50}&per_page=${limit ?? 20}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${message}` };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return {
      success: false,
      error: `iNaturalist returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let data: RawSpeciesCountResponse;
  try {
    data = (await response.json()) as RawSpeciesCountResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse response: ${message}` };
  }

  return {
    success: true,
    species: data.results.map((entry) => ({
      count: entry.count,
      taxon: mapTaxon(entry.taxon),
    })),
    totalResults: data.total_results,
  };
}

export async function getTaxonByName(
  scientificName: string
): Promise<INatTaxon | null> {
  const result = await searchTaxa(scientificName, 1);
  if (!result.success) {
    return null;
  }
  const match = result.taxa.find(
    (t) => t.name.toLowerCase() === scientificName.toLowerCase()
  );
  return match ?? null;
}
