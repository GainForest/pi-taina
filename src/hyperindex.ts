// Hyperindex GraphQL client for Pi-Tainá
// Queries the GainForest Hyperindex public read API to fetch org context at startup.

const HYPERINDEX_URL = "https://api.hi.gainforest.app/graphql";
const TIMEOUT_MS = 10_000;

export interface OrgContext {
  displayName: string | null;
  description: string | null;
  organizationType: string[] | null;
  country: string | null;
}

// Module-level cache — populated by initOrgContext()
let _cachedOrgContext: OrgContext | null = null;

/**
 * Fetch the organization context for a given DID from the Hyperindex GraphQL API.
 * Returns null if the query fails or no results are found (fail-soft).
 */
export async function fetchOrgContext(did: string): Promise<OrgContext | null> {
  const query = `{
    appCertifiedActorProfile(first: 1, where: { did: { eq: "${did}" } }) {
      edges { node { displayName description } }
    }
    appCertifiedActorOrganization(first: 1, where: { did: { eq: "${did}" } }) {
      edges { node { organizationType } }
    }
  }`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(HYPERINDEX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`⚠️  Hyperindex query failed: HTTP ${response.status}`);
      return null;
    }

    const json = (await response.json()) as {
      data?: {
        appCertifiedActorProfile?: {
          edges: Array<{ node: { displayName?: string | null; description?: string | null } }>;
        };
        appCertifiedActorOrganization?: {
          edges: Array<{ node: { organizationType?: string[] | null } }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors && json.errors.length > 0) {
      console.warn("⚠️  Hyperindex GraphQL errors:", json.errors.map((e) => e.message).join(", "));
      return null;
    }

    const profileEdges = json.data?.appCertifiedActorProfile?.edges ?? [];
    const orgEdges = json.data?.appCertifiedActorOrganization?.edges ?? [];

    const profile = profileEdges[0]?.node ?? null;
    const org = orgEdges[0]?.node ?? null;

    if (!profile && !org) {
      return null;
    }

    // Attempt to extract country from description (best-effort heuristic)
    let country: string | null = null;
    if (profile?.description) {
      // Look for a country name pattern — simple heuristic, can be improved
      const countryMatch = profile.description.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)*)\s*$/);
      if (countryMatch) {
        country = countryMatch[1];
      }
    }

    return {
      displayName: profile?.displayName ?? null,
      description: profile?.description ?? null,
      organizationType: org?.organizationType ?? null,
      country,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn("⚠️  Hyperindex query timed out after 10s");
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("⚠️  Hyperindex query error:", message);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch and cache the org context for the given DID.
 * Fails softly — logs a warning if the query fails, does not throw.
 */
export async function initOrgContext(did: string): Promise<void> {
  try {
    const ctx = await fetchOrgContext(did);
    _cachedOrgContext = ctx;
    if (ctx?.displayName) {
      console.log(`🏛️ Organization: ${ctx.displayName}`);
    } else {
      console.log("ℹ️  No organization context found in Hyperindex for this account");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("⚠️  Failed to initialize org context:", message);
  }
}

/**
 * Return the cached OrgContext (synchronous).
 * Returns null if initOrgContext() has not been called or the query failed.
 */
export function getOrgContext(): OrgContext | null {
  return _cachedOrgContext;
}
