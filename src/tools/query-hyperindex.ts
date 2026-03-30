export type QueryType = 'occurrences' | 'hypercerts' | 'search';

export interface QueryInput {
  type: QueryType;
  // For occurrences/hypercerts: filter by DID
  did?: string;
  // For occurrences: filter by who recorded it (uses 'contains' match)
  recordedByContains?: string;
  // For search: free-text query
  searchQuery?: string;
  // Pagination
  limit?: number;  // default 10, max 20
}

export interface QueryResult {
  success: true;
  type: QueryType;
  totalCount: number;
  records: Array<{
    uri: string;
    // Occurrence fields
    scientificName?: string;
    vernacularName?: string;
    eventDate?: string;
    country?: string;
    locality?: string;
    recordedBy?: string;
    // Hypercert fields
    title?: string;
    shortDescription?: string;
    // Common
    did: string;
    createdAt?: string;
    hyperscanUrl: string;
  }>;
}

export interface QueryError {
  success: false;
  error: string;
}

export type QueryResponse = QueryResult | QueryError;

const HYPERINDEX_URL = 'https://api.hi.gainforest.app/graphql';

/**
 * Build a hyperscan URL from a URI.
 * URIs are typically in the format: at://did:plc:xxx/collection/rkey
 * Hyperscan URL: https://hyperscan.gainforest.app/at/did:plc:xxx/collection/rkey
 */
function buildHyperscanUrl(uri: string): string {
  // Convert at:// URI to hyperscan URL
  if (uri.startsWith('at://')) {
    const path = uri.slice('at://'.length);
    return `https://hyperscan.gainforest.app/at/${path}`;
  }
  // Fallback: just append the URI as-is
  return `https://hyperscan.gainforest.app/${uri}`;
}

/**
 * Build GraphQL query string for occurrences.
 */
function buildOccurrencesQuery(limit: number, did?: string, recordedByContains?: string): string {
  const filters: string[] = [];
  if (did) filters.push(`did: { eq: "${did}" }`);
  if (recordedByContains) filters.push(`recordedBy: { contains: "${recordedByContains}" }`);
  const whereClause = filters.length > 0 ? `, where: { ${filters.join(', ')} }` : '';
  return `query {
  appGainforestDwcOccurrence(first: ${limit}${whereClause}) {
    edges { node { uri did scientificName vernacularName eventDate country locality recordedBy createdAt } }
    totalCount
  }
}`;
}

/**
 * Build GraphQL query string for hypercerts.
 */
function buildHypercertsQuery(limit: number, did?: string): string {
  const whereClause = did ? `, where: { did: { eq: "${did}" } }` : '';
  return `query {
  orgHypercertsClaimActivity(first: ${limit}${whereClause}) {
    edges { node { uri did title shortDescription createdAt } }
    totalCount
  }
}`;
}

/**
 * Build GraphQL query string for free-text search.
 */
function buildSearchQuery(limit: number, searchQuery: string): string {
  return `query {
  search(query: "${searchQuery}", first: ${limit}) {
    edges { node { uri did collection } }
    totalCount
  }
}`;
}

interface OccurrenceNode {
  uri: string;
  did: string;
  scientificName?: string;
  vernacularName?: string;
  eventDate?: string;
  country?: string;
  locality?: string;
  recordedBy?: string;
  createdAt?: string;
}

interface HypercertNode {
  uri: string;
  did: string;
  title?: string;
  shortDescription?: string;
  createdAt?: string;
}

interface SearchNode {
  uri: string;
  did: string;
  collection?: string;
}

interface GraphQLEdge<T> {
  node: T;
}

interface GraphQLConnection<T> {
  edges: Array<GraphQLEdge<T>>;
  totalCount: number;
}

interface OccurrencesData {
  appGainforestDwcOccurrence: GraphQLConnection<OccurrenceNode>;
}

interface HypercertsData {
  orgHypercertsClaimActivity: GraphQLConnection<HypercertNode>;
}

interface SearchData {
  search: GraphQLConnection<SearchNode>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function queryHyperindex(input: QueryInput): Promise<QueryResponse> {
  const limit = Math.min(input.limit ?? 10, 20);

  let query: string;
  if (input.type === 'occurrences') {
    query = buildOccurrencesQuery(limit, input.did, input.recordedByContains);
  } else if (input.type === 'hypercerts') {
    query = buildHypercertsQuery(limit, input.did);
  } else {
    // search
    if (!input.searchQuery) {
      return { success: false, error: 'searchQuery is required for type=search' };
    }
    query = buildSearchQuery(limit, input.searchQuery);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(HYPERINDEX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query }),
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
      error: `Hyperindex returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let json: GraphQLResponse<OccurrencesData | HypercertsData | SearchData>;
  try {
    json = await response.json() as GraphQLResponse<OccurrencesData | HypercertsData | SearchData>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse response: ${message}` };
  }

  if (json.errors && json.errors.length > 0) {
    return { success: false, error: json.errors.map(e => e.message).join('; ') };
  }

  if (!json.data) {
    return { success: false, error: 'No data returned from Hyperindex' };
  }

  if (input.type === 'occurrences') {
    const data = json.data as OccurrencesData;
    const connection = data.appGainforestDwcOccurrence;
    if (!connection) {
      return { success: false, error: 'Unexpected response structure for occurrences' };
    }
    const records = connection.edges.map(edge => {
      const node = edge.node;
      return {
        uri: node.uri,
        did: node.did,
        ...(node.scientificName !== undefined && { scientificName: node.scientificName }),
        ...(node.vernacularName !== undefined && { vernacularName: node.vernacularName }),
        ...(node.eventDate !== undefined && { eventDate: node.eventDate }),
        ...(node.country !== undefined && { country: node.country }),
        ...(node.locality !== undefined && { locality: node.locality }),
        ...(node.recordedBy !== undefined && { recordedBy: node.recordedBy }),
        ...(node.createdAt !== undefined && { createdAt: node.createdAt }),
        hyperscanUrl: buildHyperscanUrl(node.uri),
      };
    });
    return {
      success: true,
      type: input.type,
      totalCount: connection.totalCount,
      records,
    };
  } else if (input.type === 'hypercerts') {
    const data = json.data as HypercertsData;
    const connection = data.orgHypercertsClaimActivity;
    if (!connection) {
      return { success: false, error: 'Unexpected response structure for hypercerts' };
    }
    const records = connection.edges.map(edge => {
      const node = edge.node;
      return {
        uri: node.uri,
        did: node.did,
        ...(node.title !== undefined && { title: node.title }),
        ...(node.shortDescription !== undefined && { shortDescription: node.shortDescription }),
        ...(node.createdAt !== undefined && { createdAt: node.createdAt }),
        hyperscanUrl: buildHyperscanUrl(node.uri),
      };
    });
    return {
      success: true,
      type: input.type,
      totalCount: connection.totalCount,
      records,
    };
  } else {
    // search
    const data = json.data as SearchData;
    const connection = data.search;
    if (!connection) {
      return { success: false, error: 'Unexpected response structure for search' };
    }
    const records = connection.edges.map(edge => {
      const node = edge.node;
      return {
        uri: node.uri,
        did: node.did,
        hyperscanUrl: buildHyperscanUrl(node.uri),
      };
    });
    return {
      success: true,
      type: input.type,
      totalCount: connection.totalCount,
      records,
    };
  }
}
