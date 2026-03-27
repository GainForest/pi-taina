// Publish hypercert activity records to ATProto (org.hypercerts.claim.activity)
// Used to document conservation or community impact work as permanent records

import { getAtprotoAgent, getCommunityDid } from "../atproto.js";
import { loadEnvConfig } from "../env.js";
import { getOrgContext } from "../hyperindex.js";
import type { TelegramUser } from "./publish-occurrence.js";

export type { TelegramUser };

export interface HypercertInput {
  title: string;                    // Required: title of the impact claim
  shortDescription: string;         // Required: brief description (max 300 graphemes)
  description?: string;             // Optional: longer description (max 3000 graphemes)
  startDate?: string;               // Optional: ISO 8601 work start date
  endDate?: string;                 // Optional: ISO 8601 work end date
  workScope?: string;               // Optional: free-form work scope tags
  // Location (optional)
  decimalLatitude?: number;
  decimalLongitude?: number;
  locationName?: string;
  // Image (optional)
  image?: { data: Buffer; mimeType: string };
  // Who submitted this
  submittedBy: TelegramUser;
}

export interface HypercertResult {
  success: true;
  uri: string;
  cid: string;
  title: string;
  hyperscanUrl: string;  // Link to view on Hyperscan
  contributorCount: number;
}

export interface HypercertError {
  success: false;
  error: string;
}

export type HypercertResponse = HypercertResult | HypercertError;

/**
 * Publish a hypercert activity record to the community ATProto PDS.
 *
 * Creates an org.hypercerts.claim.activity record, optionally with a location
 * (app.certified.location) and image blob. Returns the ATProto URI, CID, and
 * a Hyperscan URL for viewing the record.
 */
export async function createHypercert(input: HypercertInput): Promise<HypercertResponse> {
  // Validate required fields
  if (!input.title || input.title.trim() === "") {
    return { success: false, error: "title is required" };
  }
  if (!input.shortDescription || input.shortDescription.trim() === "") {
    return { success: false, error: "shortDescription is required" };
  }

  // Get ATProto agent — return error if not configured
  let agent;
  try {
    const config = loadEnvConfig();
    agent = await getAtprotoAgent(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `ATProto not configured: ${message}` };
  }

  const did = getCommunityDid();
  const createdAt = new Date().toISOString();

  // Upload image blob if provided
  let imageBlob: { ref: unknown; mimeType: string; size: number } | undefined;
  if (input.image) {
    try {
      const uploadResponse = await agent.uploadBlob(input.image.data, {
        encoding: input.image.mimeType,
      });
      // Serialize through JSON to avoid CID serialization issues (same pattern as publish-occurrence.ts)
      const blobRef = JSON.parse(JSON.stringify(uploadResponse.data.blob));
      imageBlob = {
        ref: blobRef.ref ?? blobRef,
        mimeType: input.image.mimeType,
        size: input.image.data.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Hypercert image upload failed (continuing without image): ${message}`);
    }
  }

  // Optionally create a location record if lat/lng provided
  let locationRef: { uri: string; cid: string } | undefined;
  const hasGps = input.decimalLatitude !== undefined && input.decimalLongitude !== undefined;
  if (hasGps) {
    try {
      const locationResult = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: 'app.certified.location',
        record: {
          $type: 'app.certified.location',
          locationType: 'coordinate-decimal',
          location: { string: `${input.decimalLatitude},${input.decimalLongitude}` },
          name: input.locationName || 'Observation site',
          createdAt,
        },
      });
      locationRef = {
        uri: locationResult.data.uri,
        cid: locationResult.data.cid,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Hypercert location record creation failed (continuing without location): ${message}`);
    }
  }

  // Build the hypercert record
  const record: Record<string, unknown> = {
    $type: 'org.hypercerts.claim.activity',
    title: input.title,
    shortDescription: input.shortDescription,
    createdAt,
    ...(input.description && { description: input.description }),
    ...(input.startDate && { startDate: input.startDate }),
    ...(input.endDate && { endDate: input.endDate }),
    ...(input.workScope && {
      workScope: {
        $type: 'org.hypercerts.claim.activity#workScopeString',
        scope: input.workScope,
      },
    }),
    ...(imageBlob && {
      image: {
        $type: 'blob',
        ref: imageBlob.ref,
        mimeType: imageBlob.mimeType,
        size: imageBlob.size,
      },
    }),
    ...(locationRef && { locations: [{ uri: locationRef.uri, cid: locationRef.cid }] }),
  };

  // Always add the submitting user as a contributor
  const contributors: Array<Record<string, unknown>> = [];

  // Contributor 1: the Telegram user who submitted
  contributors.push({
    contributorIdentity: {
      $type: 'org.hypercerts.claim.activity#contributorIdentity',
      identity: input.submittedBy.username
        ? `tg:${input.submittedBy.username}`
        : `tg:user:${input.submittedBy.id}`,
    },
    contributionDetails: {
      $type: 'org.hypercerts.claim.activity#contributorRole',
      role: 'submitter',
    },
    contributionWeight: '1',
  });

  // Contributor 2: the community org (if available)
  const org = getOrgContext();
  if (org?.displayName) {
    contributors.push({
      contributorIdentity: {
        $type: 'org.hypercerts.claim.activity#contributorIdentity',
        identity: did,  // the community DID
      },
      contributionDetails: {
        $type: 'org.hypercerts.claim.activity#contributorRole',
        role: 'organization',
      },
      contributionWeight: '1',
    });
  }

  record.contributors = contributors;

  // Create the record in collection org.hypercerts.claim.activity
  let createResult;
  try {
    createResult = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: 'org.hypercerts.claim.activity',
      record,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create hypercert: ${message}` };
  }

  // Build hyperscanUrl — extract rkey from the URI
  const rkey = createResult.data.uri.split('/').pop() ?? '';
  const hyperscanUrl = `https://www.hyperscan.dev/data?did=${encodeURIComponent(did)}&collection=org.hypercerts.claim.activity&rkey=${rkey}`;

  return {
    success: true,
    uri: createResult.data.uri,
    cid: createResult.data.cid,
    title: input.title,
    hyperscanUrl,
    contributorCount: contributors.length,
  };
}
