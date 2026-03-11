// Publish Darwin Core occurrence records to the community ATProto PDS
// Ported from taina-v3-2, simplified for the community account model

import { getAtprotoAgent, getCommunityDid, getCommunityHandle } from "../atproto.js";
import { loadEnvConfig } from "../env.js";

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

  // Image (raw bytes, will be uploaded to PDS as blob)
  imageData?: Buffer;
  imageMimeType?: string;

  // Who submitted this (Telegram user info)
  submittedBy: TelegramUser;
}

export interface PublishResult {
  success: true;
  uri: string;
  cid: string;
  scientificName: string;
  vernacularName?: string;
  location: string;
  date: string;
  hasImage: boolean;
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
export async function publishOccurrence(input: OccurrenceInput): Promise<PublishResponse> {
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

  let agent;
  try {
    const config = loadEnvConfig();
    agent = await getAtprotoAgent(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `ATProto agent error: ${message}` };
  }

  const did = getCommunityDid();
  const communityHandle = getCommunityHandle();

  // Build recordedBy string — include all three Telegram user identifiers
  const { id, username, displayName } = input.submittedBy;
  const recordedBy = username
    ? `${displayName} (@${username}, tg:${id})`
    : `${displayName} (tg:${id})`;

  const recordedByID = `telegram:${id}`;

  // Determine event date (default to today)
  const eventDate = input.eventDate ?? new Date().toISOString().split("T")[0];
  const createdAt = new Date().toISOString();

  // Build the Darwin Core record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record: Record<string, any> = {
    $type: "app.gainforest.dwc.occurrence",
    scientificName: input.scientificName,
    basisOfRecord: input.basisOfRecord ?? "HumanObservation",
    occurrenceStatus: "present",
    recordedBy,
    recordedByID,
    rightsHolder: communityHandle,
    eventDate,
    createdAt,
  };

  // Optional taxonomy / vernacular
  if (input.vernacularName) {
    record.vernacularName = input.vernacularName;
  }

  // Location fields
  if (hasGps) {
    record.decimalLatitude = input.decimalLatitude;
    record.decimalLongitude = input.decimalLongitude;
    record.geodeticDatum = "EPSG:4326";
    if (input.coordinateUncertaintyInMeters !== undefined) {
      record.coordinateUncertaintyInMeters = input.coordinateUncertaintyInMeters;
    }
  }
  if (input.locality) record.locality = input.locality;
  if (input.country) record.country = input.country;
  if (input.countryCode) record.countryCode = input.countryCode;

  // Optional observation details
  if (input.habitat) record.habitat = input.habitat;
  if (input.behavior) record.behavior = input.behavior;
  if (input.individualCount !== undefined) record.individualCount = input.individualCount;
  if (input.occurrenceRemarks) record.occurrenceRemarks = input.occurrenceRemarks;

  // Upload image blob if provided
  let hasImage = false;
  if (input.imageData && input.imageMimeType) {
    try {
      const uploadResponse = await agent.uploadBlob(input.imageData, {
        encoding: input.imageMimeType,
      });

      // Serialize through JSON to avoid CID serialization issues (same pattern as taina-v3-2)
      const blobRef = JSON.parse(JSON.stringify(uploadResponse.data.blob));

      record.imageEvidence = [{ file: blobRef }];
      hasImage = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Image upload failed: ${message}` };
    }
  }

  // Publish the record
  let createResult;
  try {
    createResult = await agent.com.atproto.repo.createRecord({
      repo: did,
      collection: "app.gainforest.dwc.occurrence",
      record,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to publish occurrence: ${message}` };
  }

  // Build human-readable location string for the result
  const locationParts: string[] = [];
  if (hasGps) {
    locationParts.push(`${input.decimalLatitude}, ${input.decimalLongitude}`);
  }
  if (input.locality) locationParts.push(input.locality);
  if (input.country) locationParts.push(input.country);
  const location = locationParts.join(", ") || "Unknown location";

  return {
    success: true,
    uri: createResult.data.uri,
    cid: createResult.data.cid,
    scientificName: input.scientificName,
    vernacularName: input.vernacularName,
    location,
    date: eventDate,
    hasImage,
  };
}
