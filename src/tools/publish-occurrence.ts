// Publish Darwin Core occurrence records to the community ATProto PDS
// Ported from taina-v3-2, simplified for the community account model

import type { AtpAgent } from "@atproto/api";
import { loadEnvConfig } from "../env.js";
import { getOrgContext } from "../hyperindex.js";
import { getPublishingClient, normalizePublishingError, type PublishingClient } from "../publishing.js";

export interface PublishAgentOverride {
  agent: AtpAgent;
  did: string;
  handle: string;
}

export interface TelegramUser {
  id: number;           // Telegram user ID (stable, numeric)
  username?: string;    // @username (can change)
  displayName: string;  // First name + last name
}

export interface OccurrenceInput {
  scientificName: string;
  vernacularName?: string;
  basisOfRecord?: string; // default "HumanObservation"

  // Location (at least one of GPS or text required)
  decimalLatitude?: number;
  decimalLongitude?: number;
  coordinateUncertaintyInMeters?: number;
  locality?: string;
  country?: string;
  countryCode?: string;

  // Optional
  eventDate?: string;  // ISO 8601, defaults to today
  habitat?: string;
  behavior?: string;
  individualCount?: number;
  occurrenceRemarks?: string;

  // Taxonomy
  kingdom?: string;
  phylum?: string;
  class_?: string;  // 'class' is reserved in JS
  order?: string;
  family?: string;
  genus?: string;
  specificEpithet?: string;
  taxonRank?: string;

  // Extended location
  stateProvince?: string;
  municipality?: string;

  // Images (raw bytes, will be uploaded to PDS as blobs)
  // Supports multiple photos from a multi-photo observation session (max 5)
  images?: Array<{ data: Buffer; mimeType: string }>;

  // Who submitted this (Telegram user info)
  submittedBy: TelegramUser;
}

export interface PublishResult {
  success: true;
  uri: string;
  cid: string;
  occurrenceID: string;
  scientificName: string;
  vernacularName?: string;
  location: string;
  date: string;
  hasImage: boolean;
  imageCount: number;
  hyperscanUrl: string;
}

export interface PublishError {
  success: false;
  error: string;
}

export type PublishResponse = PublishResult | PublishError;

/**
 * Publish a Darwin Core occurrence record to the community ATProto PDS.
 *
 * Validates that at least one location (GPS or text) is provided and that
 * scientificName is set. Uploads image blob if provided. Returns the ATProto
 * URI and CID on success.
 */
export async function publishOccurrence(
  input: OccurrenceInput,
  override?: PublishAgentOverride,
): Promise<PublishResponse> {
  // Validate required fields
  if (!input.scientificName || input.scientificName.trim() === "") {
    return { success: false, error: "scientificName is required" };
  }

  const hasGps =
    input.decimalLatitude !== undefined && input.decimalLongitude !== undefined;
  const hasTextLocation =
    (input.locality && input.locality.trim() !== "") ||
    (input.country && input.country.trim() !== "") ||
    (input.countryCode && input.countryCode.trim() !== "");

  if (!hasGps && !hasTextLocation) {
    return {
      success: false,
      error: "At least one location is required: GPS coordinates or a text location (locality, country, or countryCode)",
    };
  }

  let publisher: Pick<PublishingClient, "did" | "handle" | "displayName" | "createRecord" | "uploadBlob">;
  if (override) {
    publisher = {
      did: override.did,
      handle: override.handle,
      async uploadBlob(data, mimeType) {
        const result = await override.agent.uploadBlob(data, { encoding: mimeType });
        return { blob: result.data.blob };
      },
      async createRecord(args) {
        const result = await override.agent.com.atproto.repo.createRecord({
          repo: override.did,
          collection: args.collection,
          record: args.record,
          rkey: args.rkey,
        });
        return { uri: result.data.uri, cid: result.data.cid };
      },
    };
  } else {
    try {
      const config = loadEnvConfig();
      publisher = await getPublishingClient(config, input.submittedBy.id);
    } catch (err) {
      return { success: false, error: `ATProto agent error: ${normalizePublishingError(err)}` };
    }
  }

  const did = publisher.did;
  const communityHandle = publisher.handle;

  // Build recordedBy string — include all three Telegram user identifiers
  // Store Telegram info in occurrenceRemarks for attribution, use handle for recordedBy
  const { id, username, displayName } = input.submittedBy;
  const telegramAttribution = username
    ? `${displayName} (@${username}, tg:${id})`
    : `${displayName} (tg:${id})`;

  // Determine event date (default to today)
  const eventDate = input.eventDate ?? new Date().toISOString().split("T")[0];
  const createdAt = new Date().toISOString();

  // Generate a stable occurrence ID for this record
  const occurrenceID = crypto.randomUUID();

  // Build the Darwin Core record
  // IMPORTANT: decimalLatitude and decimalLongitude MUST be strings per the lexicon schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record: Record<string, any> = {
    $type: "app.gainforest.dwc.occurrence",
    scientificName: input.scientificName,
    basisOfRecord: input.basisOfRecord ?? "HumanObservation",
    occurrenceStatus: "present",
    recordedBy: telegramAttribution,
    recordedByID: did,
    rightsHolder: communityHandle,
    eventDate,
    createdAt,
  };

  // Org context — institutionCode, rightsHolder, datasetName
  const org = getOrgContext();
  const organizationName = publisher.displayName ?? org?.displayName;
  if (organizationName) {
    record.institutionCode = organizationName;
    record.rightsHolder = organizationName;
    record.datasetName = organizationName + " Community Observations";
  }
  if (!record.datasetName) {
    record.datasetName = "Pi-Tainá Community Observations";
  }

  // Metadata defaults
  record.license = "http://creativecommons.org/licenses/by/4.0/";
  record.identifiedBy = "Gemini AI | " + telegramAttribution;
  record.dateIdentified = createdAt;
  record.occurrenceID = occurrenceID;

  // Optional taxonomy / vernacular
  if (input.vernacularName) {
    record.vernacularName = input.vernacularName;
  }

  // Taxonomy fields
  if (input.kingdom) record.kingdom = input.kingdom;
  if (input.phylum) record.phylum = input.phylum;
  if (input.class_) record.class = input.class_;  // ATProto field is 'class', JS var is 'class_'
  if (input.order) record.order = input.order;
  if (input.family) record.family = input.family;
  if (input.genus) record.genus = input.genus;
  if (input.specificEpithet) record.specificEpithet = input.specificEpithet;
  if (input.taxonRank) record.taxonRank = input.taxonRank;

  // Build higherClassification from available taxonomy parts
  const taxParts = [input.kingdom, input.phylum, input.class_, input.order, input.family, input.genus].filter(Boolean);
  if (taxParts.length > 0) record.higherClassification = taxParts.join("|");

  // Nomenclatural code based on kingdom
  if (input.kingdom) {
    const kingdomLower = input.kingdom.toLowerCase();
    if (kingdomLower === "animalia") record.nomenclaturalCode = "ICZN";
    else if (kingdomLower === "plantae" || kingdomLower === "fungi") record.nomenclaturalCode = "ICN";
  }

  // Location fields — coordinates MUST be strings per ATProto lexicon
  if (hasGps) {
    record.decimalLatitude = String(input.decimalLatitude);
    record.decimalLongitude = String(input.decimalLongitude);
    record.geodeticDatum = "EPSG:4326";
    if (input.coordinateUncertaintyInMeters !== undefined) {
      record.coordinateUncertaintyInMeters = input.coordinateUncertaintyInMeters;
    } else {
      record.coordinateUncertaintyInMeters = 50;  // reasonable default for phone GPS
    }
  }
  if (input.locality) record.locality = input.locality;
  if (input.country) record.country = input.country;
  if (input.countryCode) record.countryCode = input.countryCode;

  // Extended location fields
  if (input.stateProvince) record.stateProvince = input.stateProvince;
  if (input.municipality) record.municipality = input.municipality;

  // Optional observation details
  if (input.habitat) record.habitat = input.habitat;
  if (input.behavior) record.behavior = input.behavior;
  if (input.individualCount !== undefined) record.individualCount = input.individualCount;
  if (input.occurrenceRemarks) record.occurrenceRemarks = input.occurrenceRemarks;

  // Upload image blobs if provided (max 5, matching lexicon constraint)
  let hasImage = false;
  let imageCount = 0;
  const imagesToUpload = (input.images ?? []).slice(0, 5);
  if (imagesToUpload.length > 0) {
    const blobRefs: unknown[] = [];
    for (const image of imagesToUpload) {
      try {
        const uploadResponse = await publisher.uploadBlob(image.data, image.mimeType);

        // Serialize through JSON to avoid CID serialization issues (same pattern as taina-v3-2)
        const blobRef = JSON.parse(JSON.stringify(uploadResponse.blob));
        blobRefs.push(blobRef);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Image upload failed (continuing with others): ${message}`);
      }
    }

    if (blobRefs.length > 0) {
      // imageEvidence is a single object { file: blobRef } per the lexicon (not an array)
      record.imageEvidence = { file: blobRefs[0] };
      if (blobRefs.length > 1) {
        // Store additional image refs in dynamicProperties as JSON
        record.dynamicProperties = JSON.stringify({
          additionalImages: blobRefs.slice(1).map((ref, i) => ({ index: i + 2, blobRef: ref })),
        });
      }
      record.dcType = "StillImage";
      hasImage = true;
      imageCount = blobRefs.length;
    }
  }

  // Publish the record
  let createResult;
  try {
    createResult = await publisher.createRecord({
      collection: "app.gainforest.dwc.occurrence",
      record,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to publish occurrence: ${normalizePublishingError(err)}` };
  }

  // Build Hyperscan URL from the AT URI
  const atUri = createResult.uri;
  const uriParts = atUri.slice("at://".length).split("/");
  const hyperscanUrl = uriParts.length >= 3
    ? `https://www.hyperscan.dev/data?did=${encodeURIComponent(uriParts[0])}&collection=${encodeURIComponent(uriParts[1])}&rkey=${encodeURIComponent(uriParts[2])}`
    : `https://www.hyperscan.dev/data?did=${encodeURIComponent(atUri)}`;

  // Build human-readable location string for the result
  const locationParts: string[] = [];
  if (hasGps) {
    locationParts.push(`${input.decimalLatitude}, ${input.decimalLongitude}`);
  }
  if (input.locality) locationParts.push(input.locality);
  if (input.country) locationParts.push(input.country);
  const location = locationParts.join(", ") || "Unknown location";

  return {
    success: true as const,
    uri: createResult.uri,
    cid: createResult.cid,
    occurrenceID: record.occurrenceID as string,
    scientificName: record.scientificName as string,
    vernacularName: record.vernacularName as string | undefined,
    location,
    date: record.eventDate as string,
    hasImage,
    imageCount,
    hyperscanUrl,
  };
}
