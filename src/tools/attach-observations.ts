// Attach community biodiversity observations as evidence to a hypercert
// Creates an org.hypercerts.context.attachment record linking occurrence URIs to a hypercert

import { getPublishingAgent, getPublishingDid } from "../atproto.js";
import { loadEnvConfig } from "../env.js";

export interface AttachInput {
  hypercertUri: string;       // AT URI of the hypercert to attach evidence to
  hypercertCid: string;       // CID of the hypercert record
  // Optional filters for which occurrences to include
  sinceDate?: string;         // Only include occurrences after this ISO date
  limit?: number;             // Max occurrences to attach (default 100, max 200)
}

export interface AttachResult {
  success: true;
  attachmentUri: string;      // URI of the created attachment record
  attachmentCid: string;
  hypercertUri: string;
  occurrenceCount: number;    // How many occurrences were linked
  occurrences: Array<{        // Summary of linked occurrences
    uri: string;
    scientificName?: string;
    eventDate?: string;
  }>;
  hyperscanUrl: string;
}

export interface AttachError {
  success: false;
  error: string;
}

export type AttachResponse = AttachResult | AttachError;

const HYPERINDEX_URL = 'https://api.hi.gainforest.app/graphql';

/**
 * Build a hyperscan URL from an AT URI.
 * URIs are typically in the format: at://did:plc:xxx/collection/rkey
 * Hyperscan URL: https://www.hyperscan.dev/data?did=...&collection=...&rkey=...
 */
function buildHyperscanUrl(uri: string): string {
  // Convert at:// URI to hyperscan.dev URL
  // Input: at://did:plc:xxx/app.gainforest.dwc.occurrence/3mieca2au6e2k
  // Output: https://www.hyperscan.dev/data?did=did%3Aplc%3Axxx&collection=app.gainforest.dwc.occurrence&rkey=3mieca2au6e2k
  if (uri.startsWith("at://")) {
    const path = uri.slice("at://".length);
    const parts = path.split("/");
    if (parts.length >= 3) {
      const did = parts[0];
      const collection = parts[1];
      const rkey = parts[2];
      return `https://www.hyperscan.dev/data?did=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
    }
  }
  // Fallback
  return `https://www.hyperscan.dev/data?did=${encodeURIComponent(uri)}`;
}

interface OccurrenceNode {
  uri: string;
  cid: string;
  scientificName?: string;
  vernacularName?: string;
  eventDate?: string;
  createdAt?: string;
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

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * Attach community biodiversity observations as verifiable evidence to a hypercert.
 *
 * 1. Queries Hyperindex for the community's occurrences by DID
 * 2. Optionally filters by sinceDate
 * 3. Creates an org.hypercerts.context.attachment record linking them to the hypercert
 */
export async function attachObservations(input: AttachInput): Promise<AttachResponse> {
  // Get ATProto agent + community DID — return error if not configured
  let agent;
  let communityDid: string;
  try {
    const config = loadEnvConfig();
    agent = await getPublishingAgent(config);
    communityDid = getPublishingDid();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `ATProto not configured: ${message}` };
  }

  // Clamp limit: default 100, max 200
  const fetchLimit = Math.min(input.limit ?? 100, 200);

  // Build GraphQL query for community's occurrences
  const query = `query {
  appGainforestDwcOccurrence(
    first: ${fetchLimit},
    where: { did: { eq: "${communityDid}" } }
  ) {
    edges { node { uri cid scientificName vernacularName eventDate createdAt } }
    totalCount
  }
}`;

  // Fetch from Hyperindex
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
    return { success: false, error: `Network error querying Hyperindex: ${message}` };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return {
      success: false,
      error: `Hyperindex returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let json: GraphQLResponse<OccurrencesData>;
  try {
    json = await response.json() as GraphQLResponse<OccurrencesData>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse Hyperindex response: ${message}` };
  }

  if (json.errors && json.errors.length > 0) {
    return { success: false, error: json.errors.map(e => e.message).join('; ') };
  }

  if (!json.data) {
    return { success: false, error: 'No data returned from Hyperindex' };
  }

  const connection = json.data.appGainforestDwcOccurrence;
  if (!connection) {
    return { success: false, error: 'Unexpected response structure from Hyperindex' };
  }

  let occurrences = connection.edges.map(edge => edge.node);

  // Filter by sinceDate if provided (client-side filter on createdAt)
  if (input.sinceDate) {
    const since = new Date(input.sinceDate).getTime();
    occurrences = occurrences.filter(occ => {
      if (!occ.createdAt) return false;
      return new Date(occ.createdAt).getTime() >= since;
    });
  }

  if (occurrences.length === 0) {
    return { success: false, error: 'No observations found to attach' };
  }

  // Build content items — lexicon max is 100
  const occurrencesToAttach = occurrences.slice(0, 100);
  const contentItems = occurrencesToAttach.map(occ => ({
    $type: 'org.hypercerts.defs#uri',
    uri: occ.uri,
  }));

  // Build the attachment record
  const record = {
    $type: 'org.hypercerts.context.attachment',
    title: `Biodiversity Evidence — ${occurrencesToAttach.length} observations`,
    shortDescription: `${occurrencesToAttach.length} species observations recorded by the community, linked as verifiable evidence for this impact claim.`,
    contentType: 'evidence',
    content: contentItems,
    subjects: [{
      uri: input.hypercertUri,
      cid: input.hypercertCid,
    }],
    createdAt: new Date().toISOString(),
  };

  // Create the record in collection org.hypercerts.context.attachment
  let createResult;
  try {
    createResult = await agent.com.atproto.repo.createRecord({
      repo: communityDid,
      collection: 'org.hypercerts.context.attachment',
      record,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create attachment record: ${message}` };
  }

  // Build hyperscan URL from the attachment URI
  const hyperscanUrl = buildHyperscanUrl(createResult.data.uri);

  // Build occurrence summary
  const occurrenceSummary = occurrencesToAttach.map(occ => ({
    uri: occ.uri,
    ...(occ.scientificName !== undefined && { scientificName: occ.scientificName }),
    ...(occ.eventDate !== undefined && { eventDate: occ.eventDate }),
  }));

  return {
    success: true,
    attachmentUri: createResult.data.uri,
    attachmentCid: createResult.data.cid,
    hypercertUri: input.hypercertUri,
    occurrenceCount: occurrencesToAttach.length,
    occurrences: occurrenceSummary,
    hyperscanUrl,
  };
}
