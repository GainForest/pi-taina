import type { AtpAgent } from "@atproto/api";
import type { PublishingClient } from "../publishing.js";

export interface CertifiedLocationPointInput {
  kind: "point";
  latitude: number;
  longitude: number;
  locationName?: string;
}

export interface CertifiedLocationPolygonInput {
  kind: "polygon";
  points: Array<{ lng: number; lat: number }>;
  locationName?: string;
}

export type CertifiedLocationInput =
  | CertifiedLocationPointInput
  | CertifiedLocationPolygonInput;

export interface CertifiedLocationResult {
  success: true;
  uri: string;
  cid: string;
}

export interface CertifiedLocationError {
  success: false;
  error: string;
}

export type CertifiedLocationResponse =
  | CertifiedLocationResult
  | CertifiedLocationError;

function closePolygonRing(points: Array<{ lng: number; lat: number }>) {
  if (points.length < 3) {
    throw new Error("polygon requires at least 3 points");
  }

  const ring = points.map((point, index) => {
    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
      throw new Error(`polygon point ${index + 1} must have finite lng and lat values`);
    }

    return [point.lng, point.lat] as [number, number];
  });
  const first = ring[0];
  const last = ring[ring.length - 1];

  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }

  return ring;
}

type CertifiedLocationWriter = AtpAgent | Pick<PublishingClient, "createRecord">;

function isPublishingWriter(writer: CertifiedLocationWriter): writer is Pick<PublishingClient, "createRecord"> {
  return "createRecord" in writer && typeof writer.createRecord === "function";
}

async function writeLocationRecord(
  writer: CertifiedLocationWriter,
  orgDid: string,
  record: Record<string, unknown>,
): Promise<{ uri: string; cid: string }> {
  if (isPublishingWriter(writer)) {
    return writer.createRecord({ collection: "app.certified.location", record });
  }

  const result = await writer.com.atproto.repo.createRecord({
    repo: orgDid,
    collection: "app.certified.location",
    record,
  });
  return { uri: result.data.uri, cid: result.data.cid };
}

export async function createCertifiedLocation(
  writer: CertifiedLocationWriter,
  orgDid: string,
  input: CertifiedLocationInput,
): Promise<CertifiedLocationResponse> {
  if (!orgDid || orgDid.trim() === "") {
    return { success: false, error: "orgDid is required" };
  }

  const createdAt = new Date().toISOString();

  let record: Record<string, unknown>;
  try {
    if (input.kind === "point") {
      if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
        return { success: false, error: "latitude and longitude are required" };
      }

      record = {
        $type: "app.certified.location",
        lpVersion: "1.0.0",
        srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        locationType: "coordinate-decimal",
        location: { string: `${input.latitude},${input.longitude}` },
        createdAt,
        ...(input.locationName && { name: input.locationName }),
      };
    } else {
      const ring = closePolygonRing(input.points);

      record = {
        $type: "app.certified.location",
        lpVersion: "1.0.0",
        srs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        locationType: "geojson",
        location: {
          string: JSON.stringify({
            type: "Polygon",
            coordinates: [ring],
          }),
        },
        createdAt,
        ...(input.locationName && { name: input.locationName }),
      };
    }

    const createResult = await writeLocationRecord(writer, orgDid, record);

    return {
      success: true,
      uri: createResult.uri,
      cid: createResult.cid,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to create certified location: ${message}` };
  }
}
