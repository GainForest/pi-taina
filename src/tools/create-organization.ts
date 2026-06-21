// Create a shared organization and write its profile/metadata records

import type { TelegramUser } from "./publish-occurrence.js";
import {
  createCertifiedLocation,
  type CertifiedLocationInput,
} from "./create-certified-location.js";
import { loadEnvConfig } from "../env.js";
import { getAtprotoAgent, getCommunityDid } from "../atproto.js";
import { getCgsClient, rememberSharedOrganization, setActiveOrganization, type OrganizationOption } from "../organizations.js";
import { normalizePublishingError, type PublishingClient } from "../publishing.js";

export type { TelegramUser };

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

  // Legacy standalone-org field. Shared organization creation ignores it.
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
  password?: string;                 // Recovery password returned once for the organization account
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
 * 1. Register a shared organization and make the signed-in bot account owner
 * 2. Write organization profile, metadata, and optional location to that org
 * 3. Select the new organization for the Telegram session
 * 4. Return { success: true, did, handle, password, profileUri, orgUri, locationUri }
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

  // Normalize handle — lowercase, no spaces. The shared organization service
  // turns this short handle into the full organization handle.
  const handleSlug = input.handle.trim().toLowerCase().replace(/\s+/g, "-");

  const config = loadEnvConfig();
  if (!config.cgsServiceUrl || !config.cgsServiceDid) {
    return {
      success: false,
      error: "Shared organization service is not configured. Set CGS_SERVICE_URL and CGS_SERVICE_DID before creating organizations.",
    };
  }

  let did: string;
  let fullHandle: string;
  let password: string | undefined;
  let publisher: Pick<PublishingClient, "did" | "handle" | "createRecord" | "putRecord" | "uploadBlob">;

  try {
    await getAtprotoAgent(config);
    const ownerDid = getCommunityDid();
    const cgs = await getCgsClient(config);
    const registered = await cgs.registerGroup({
      handle: handleSlug,
      ownerDid,
      ...(input.email && { email: input.email }),
    });

    did = registered.groupDid;
    fullHandle = registered.handle;
    password = registered.accountPassword;

    const createdAtForStore = new Date().toISOString();
    rememberSharedOrganization({
      handle: fullHandle,
      did,
      role: "owner",
      serviceDid: config.cgsServiceDid,
      createdAt: createdAtForStore,
      recoveryPassword: password,
    });

    const option: OrganizationOption = {
      id: `group:${did}`,
      kind: "group",
      did,
      handle: fullHandle,
      displayName: input.displayName,
      role: "owner",
      serviceDid: config.cgsServiceDid,
      serviceUrl: config.cgsServiceUrl,
    };
    setActiveOrganization(input.submittedBy.id, option);

    publisher = {
      did,
      handle: fullHandle,
      async createRecord(args) {
        return cgs.createRecord({ repo: did, ...args });
      },
      async putRecord(args) {
        return cgs.putRecord({ repo: did, ...args });
      },
      async uploadBlob(data, mimeType) {
        return cgs.uploadBlob(did, data, mimeType);
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to create organization: ${normalizePublishingError(err)}` };
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
        publisher,
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
      const uploadResponse = await publisher.uploadBlob(input.avatar.data, input.avatar.mimeType);
      // Serialize through JSON to avoid CID serialization issues
      const blobRef = JSON.parse(JSON.stringify(uploadResponse.blob));
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
      const uploadResponse = await publisher.uploadBlob(input.banner.data, input.banner.mimeType);
      const blobRef = JSON.parse(JSON.stringify(uploadResponse.blob));
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
    const profileResult = await publisher.putRecord({
      collection: "app.certified.actor.profile",
      rkey: "self",
      record: profileRecord,
    });
    profileUri = profileResult.uri;
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
    const orgResult = await publisher.putRecord({
      collection: "app.certified.actor.organization",
      rkey: "self",
      record: orgRecord,
    });
    orgUri = orgResult.uri;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Organization record creation failed (continuing): ${message}`);
    orgUri = `at://${did}/app.certified.actor.organization/self`;
  }

  // Step 7: putRecord for app.gainforest.organization.info/self
  try {
    await publisher.putRecord({
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
      await publisher.putRecord({
        collection: "app.gainforest.organization.defaultSite",
        rkey: "self",
        record: buildDefaultSiteRecord(locationUri, createdAt),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Default site record creation failed (continuing): ${message}`);
    }
  }

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
