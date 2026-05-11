// Create an organization account on the gainforest.id ATProto PDS
// Creates a new ATProto account + profile, organization, and info records

import { AtpAgent } from "@atproto/api";
import crypto from "crypto";
import type { TelegramUser } from "./publish-occurrence.js";
import {
  createCertifiedLocation,
  type CertifiedLocationInput,
} from "./create-certified-location.js";
import { saveOrgAccount } from "../org-accounts.js";

export type { TelegramUser };

const PDS_ENDPOINT = "https://gainforest.id";

export interface OrganizationInput {
  // Required
  handle: string;                    // e.g. "cabarete-sostenible" (without .gainforest.id)
  email?: string;                    // For account recovery on gainforest.id
  displayName: string;               // Organization display name (min 8 chars enforced by lexicon)
  description: string;               // About the organization
  organizationType: string[];        // ["nonprofit", "conservation", etc.]

  // Required by app.gainforest.organization.info lexicon
  country: string;                   // ISO 3166-1 alpha-2 (e.g. "DO", "BR")
  objectives: string[];              // Conservation | Research | Education | Community | Other

  // Invite code for the gainforest.id PDS. Required by the server.
  // Falls back to process.env.GAINFOREST_INVITE_CODE if omitted.
  inviteCode?: string;

  // Optional - profile
  website?: string;
  avatar?: { data: Buffer; mimeType: string };
  banner?: { data: Buffer; mimeType: string };

  // Optional - org details
  foundedDate?: string;              // ISO 8601 date
  urls?: Array<{ url: string; label?: string }>;
  ecosystemTypes?: string[];         // tropical-rainforest | mangrove | coral-reef | wetland | etc.
  focusSpeciesGroups?: string[];     // birds | mammals | trees | fish | insects | etc.
  socialLinks?: Array<{ platform: string; url: string }>; // twitter | instagram | facebook | etc.

  // Optional - location
  decimalLatitude?: number;
  decimalLongitude?: number;
  locationName?: string;
  polygonPoints?: Array<{ lng: number; lat: number }>;

  // Who submitted this
  submittedBy: TelegramUser;
}

export interface OrganizationResult {
  success: true;
  did: string;                       // Created DID
  handle: string;                    // Full handle e.g. "cabarete-sostenible.gainforest.id"
  password: string;                  // Generated password (for credential storage)
  profileUri: string;
  orgUri: string;
  locationUri?: string;
}

export interface OrganizationError {
  success: false;
  error: string;
}

export type OrganizationResponse = OrganizationResult | OrganizationError;

/**
 * Generate a secure random alphanumeric password of the given length.
 */
function generatePassword(length: number = 32): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Extract the first sentence from a string (up to the first period, question mark, or exclamation).
 */
function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]+[.!?]/);
  return match ? match[0].trim() : text.slice(0, 200).trim();
}

/**
 * Build the app.gainforest.organization.info/self record from an OrganizationInput.
 * Exported for unit tests so the lexicon-required shape can be verified without
 * a network round-trip.
 *
 * shortDescription must be app.gainforest.common.defs#richtext (object).
 * longDescription must be pub.leaflet.pages.linearDocument (object).
 */
export function buildOrgInfoRecord(
  input: OrganizationInput,
  createdAt: string,
): Record<string, unknown> {
  return {
    $type: "app.gainforest.organization.info",
    displayName: input.displayName,
    shortDescription: {
      $type: "app.gainforest.common.defs#richtext",
      text: firstSentence(input.description),
    },
    longDescription: {
      $type: "pub.leaflet.pages.linearDocument",
      blocks: [
        {
          block: {
            $type: "pub.leaflet.blocks.text",
            plaintext: input.description,
          },
        },
      ],
    },
    country: input.country,
    objectives: input.objectives,
    visibility: "Public",
    createdAt,
    ...(input.ecosystemTypes && input.ecosystemTypes.length > 0 && { ecosystemTypes: input.ecosystemTypes }),
    ...(input.focusSpeciesGroups && input.focusSpeciesGroups.length > 0 && { focusSpeciesGroups: input.focusSpeciesGroups }),
    ...(input.website && { website: input.website }),
    ...(input.foundedDate && { startDate: input.foundedDate }),
    ...(input.socialLinks && input.socialLinks.length > 0 && { socialLinks: input.socialLinks }),
  };
}

/**
 * Build the app.gainforest.organization.defaultSite/self record. Points at the
 * at-uri of the org's app.certified.location record.
 */
export function buildDefaultSiteRecord(
  locationUri: string,
  createdAt: string,
): Record<string, unknown> {
  return {
    $type: "app.gainforest.organization.defaultSite",
    site: locationUri,
    createdAt,
  };
}

function buildCertifiedLocationInput(
  input: OrganizationInput,
): CertifiedLocationInput | undefined {
  if (input.polygonPoints && input.polygonPoints.length >= 3) {
    return {
      kind: "polygon",
      points: input.polygonPoints,
      locationName: input.locationName,
    };
  }

  if (
    typeof input.decimalLatitude === "number" &&
    Number.isFinite(input.decimalLatitude) &&
    typeof input.decimalLongitude === "number" &&
    Number.isFinite(input.decimalLongitude)
  ) {
    return {
      kind: "point",
      latitude: input.decimalLatitude,
      longitude: input.decimalLongitude,
      locationName: input.locationName,
    };
  }

  return undefined;
}

/**
 * Create an organization on the gainforest.id ATProto PDS.
 *
 * Steps:
 * 1. Generate a secure random password
 * 2. Create account via com.atproto.server.createAccount
 * 3. Login with the new account to get an authenticated AtpAgent
 * 4. Upload avatar/banner blobs if provided
 * 5. putRecord app.certified.actor.profile/self
 * 6. putRecord app.certified.actor.organization/self
 * 7. putRecord app.gainforest.organization.info/self
 * 8. If a location was created, putRecord app.gainforest.organization.defaultSite/self
 * 9. Return { success: true, did, handle, password, profileUri, orgUri, locationUri }
 */
export async function createOrganization(input: OrganizationInput): Promise<OrganizationResponse> {
  // Basic validation
  if (!input.handle || input.handle.trim() === "") {
    return { success: false, error: "handle is required" };
  }
  if (!input.displayName || input.displayName.trim() === "") {
    return { success: false, error: "displayName is required" };
  }
  if (!input.description || input.description.trim() === "") {
    return { success: false, error: "description is required" };
  }
  if (!input.organizationType || input.organizationType.length === 0) {
    return { success: false, error: "organizationType is required" };
  }
  if (!input.country || input.country.trim().length !== 2) {
    return { success: false, error: "country is required (ISO 3166-1 alpha-2, e.g. 'DO', 'BR')" };
  }
  if (!input.objectives || input.objectives.length === 0) {
    return { success: false, error: "objectives is required (one or more of: Conservation, Research, Education, Community, Other)" };
  }
  if (input.displayName.trim().length < 8) {
    return { success: false, error: "displayName must be at least 8 characters" };
  }

  // Resolve invite code from input, falling back to the env var.
  // gainforest.id reports inviteCodeRequired=true, so we fail fast with a
  // clear message rather than letting the PDS reject the createAccount call.
  const inviteCode = input.inviteCode?.trim() || process.env.GAINFOREST_INVITE_CODE?.trim();
  if (!inviteCode) {
    return {
      success: false,
      error: "Invite code is required to create an organization on gainforest.id. Provide one when creating the org, or set GAINFOREST_INVITE_CODE in .env.",
    };
  }

  // Normalize handle — lowercase, no spaces
  const handleSlug = input.handle.trim().toLowerCase().replace(/\s+/g, "-");
  const fullHandle = `${handleSlug}.gainforest.id`;

  // Step 1: Generate a secure random password
  const password = generatePassword(32);

  // Step 2: Create account on gainforest.id
  let did: string;
  try {
    const createAccountRes = await fetch(`${PDS_ENDPOINT}/xrpc/com.atproto.server.createAccount`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        handle: fullHandle,
        password,
        inviteCode,
        ...(input.email && { email: input.email }),
      }),
    });

    if (!createAccountRes.ok) {
      const errorBody = await createAccountRes.text();
      let errorMessage = `HTTP ${createAccountRes.status}`;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.message ?? parsed.error ?? errorMessage;
      } catch {
        // ignore JSON parse errors
      }
      if (createAccountRes.status === 400 && errorMessage.toLowerCase().includes("handle")) {
        return { success: false, error: `Handle already taken: ${fullHandle}` };
      }
      const lowered = errorMessage.toLowerCase();
      if (lowered.includes("invite") || lowered.includes("code")) {
        return { success: false, error: `Invite code rejected by gainforest.id: ${errorMessage}` };
      }
      return { success: false, error: `Failed to create account: ${errorMessage}` };
    }

    const accountData = await createAccountRes.json() as { did: string };
    did = accountData.did;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create account: ${message}` };
  }

  // Step 3: Login with the new account to get an authenticated AtpAgent
  const agent = new AtpAgent({ service: PDS_ENDPOINT });
  try {
    await agent.login({ identifier: fullHandle, password });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Account created (${did}) but login failed: ${message}` };
  }

  const createdAt = new Date().toISOString();
  let profileUri = "";
  let orgUri = "";
  let locationUri: string | undefined;
  let locationRef: { uri: string; cid: string } | undefined;

  const certifiedLocationInput = buildCertifiedLocationInput(input);
  if (certifiedLocationInput) {
    try {
      const locationResult = await createCertifiedLocation(
        agent,
        did,
        certifiedLocationInput,
      );

      if (locationResult.success) {
        locationUri = locationResult.uri;
        locationRef = { uri: locationResult.uri, cid: locationResult.cid };
      } else {
        console.error(
          `Organization location creation failed (continuing without location): ${locationResult.error}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `Organization location creation failed (continuing without location): ${message}`,
      );
    }
  }

  // Step 4: Upload avatar blob if provided
  let avatarBlob: { ref: unknown; mimeType: string; size: number } | undefined;
  if (input.avatar) {
    try {
      const uploadResponse = await agent.uploadBlob(input.avatar.data, {
        encoding: input.avatar.mimeType,
      });
      // Serialize through JSON to avoid CID serialization issues
      const blobRef = JSON.parse(JSON.stringify(uploadResponse.data.blob));
      avatarBlob = {
        ref: blobRef.ref ?? blobRef,
        mimeType: input.avatar.mimeType,
        size: input.avatar.data.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Avatar upload failed (continuing without avatar): ${message}`);
    }
  }

  // Upload banner blob if provided
  let bannerBlob: { ref: unknown; mimeType: string; size: number } | undefined;
  if (input.banner) {
    try {
      const uploadResponse = await agent.uploadBlob(input.banner.data, {
        encoding: input.banner.mimeType,
      });
      const blobRef = JSON.parse(JSON.stringify(uploadResponse.data.blob));
      bannerBlob = {
        ref: blobRef.ref ?? blobRef,
        mimeType: input.banner.mimeType,
        size: input.banner.data.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Banner upload failed (continuing without banner): ${message}`);
    }
  }

  // Step 5: putRecord for app.certified.actor.profile/self
  const profileRecord: Record<string, unknown> = {
    $type: "app.certified.actor.profile",
    displayName: input.displayName,
    description: input.description,
    createdAt,
    ...(input.website && { website: input.website }),
    ...(avatarBlob && {
      avatar: {
        $type: "org.hypercerts.defs#smallImage",
        image: {
          $type: "blob",
          ref: avatarBlob.ref,
          mimeType: avatarBlob.mimeType,
          size: avatarBlob.size,
        },
      },
    }),
    ...(bannerBlob && {
      banner: {
        $type: "org.hypercerts.defs#largeImage",
        image: {
          ref: bannerBlob.ref,
          size: bannerBlob.size,
          mimeType: bannerBlob.mimeType,
          original: {
            $type: "blob",
            ref: bannerBlob.ref,
            mimeType: bannerBlob.mimeType,
            size: bannerBlob.size,
          },
        },
      },
    }),
  };

  try {
    const profileResult = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: "app.certified.actor.profile",
      rkey: "self",
      record: profileRecord,
    });
    profileUri = profileResult.data.uri;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Profile record creation failed (continuing): ${message}`);
    // Still return success with partial info
    profileUri = `at://${did}/app.certified.actor.profile/self`;
  }

  // Step 6: putRecord for app.certified.actor.organization/self
  const orgRecord: Record<string, unknown> = {
    $type: "app.certified.actor.organization",
    organizationType: input.organizationType,
    createdAt,
    ...(locationRef && { location: locationRef }),
    ...(input.foundedDate && { foundedDate: input.foundedDate }),
    ...(input.urls && input.urls.length > 0 && { urls: input.urls }),
  };

  try {
    const orgResult = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: "app.certified.actor.organization",
      rkey: "self",
      record: orgRecord,
    });
    orgUri = orgResult.data.uri;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Organization record creation failed (continuing): ${message}`);
    orgUri = `at://${did}/app.certified.actor.organization/self`;
  }

  // Step 7: putRecord for app.gainforest.organization.info/self
  try {
    await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: "app.gainforest.organization.info",
      rkey: "self",
      record: buildOrgInfoRecord(input, createdAt),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Organization info record creation failed (continuing): ${message}`);
  }

  // Step 8: If a location was created, declare it as the default site for the org.
  // app.gainforest.organization.defaultSite/self points at an app.certified.location at-uri.
  if (locationUri) {
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: "app.gainforest.organization.defaultSite",
        rkey: "self",
        record: buildDefaultSiteRecord(locationUri, createdAt),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Default site record creation failed (continuing): ${message}`);
    }
  }

  // Step 9: Save credentials for future publishing, then return success
  saveOrgAccount({ handle: fullHandle, did, password, createdAt });

  return {
    success: true,
    did,
    handle: fullHandle,
    password,
    profileUri,
    orgUri,
    ...(locationUri && { locationUri }),
  };
}
