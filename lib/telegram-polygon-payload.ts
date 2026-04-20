export type TelegramPolygonPoint = {
  lng: number;
  lat: number;
};

export type TelegramPolygonBBox = [number, number, number, number];

export type TelegramPolygonGeoJSON = {
  type: "Polygon";
  coordinates: number[][][];
};

export type TelegramPolygonPayloadError = {
  code:
    | "invalid_json"
    | "invalid_shape"
    | "too_few_points"
    | "non_finite_coordinate";
  message: string;
};

export type TelegramPolygonPayloadSuccess = {
  ok: true;
  points: TelegramPolygonPoint[];
  polygon: TelegramPolygonGeoJSON;
  bbox: TelegramPolygonBBox;
};

export type TelegramPolygonPayloadFailure = {
  ok: false;
  error: TelegramPolygonPayloadError;
};

export type TelegramPolygonPayloadResult =
  | TelegramPolygonPayloadSuccess
  | TelegramPolygonPayloadFailure;

type TelegramPolygonPayloadShape =
  | TelegramPolygonPoint[]
  | { points: TelegramPolygonPoint[] };

export function isTelegramPolygonPoint(value: unknown): value is TelegramPolygonPoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybePoint = value as Record<string, unknown>;
  return typeof maybePoint.lng === "number" && typeof maybePoint.lat === "number";
}

export function closeTelegramPolygonRing(points: TelegramPolygonPoint[]): TelegramPolygonPoint[] {
  if (points.length === 0) return [];

  const first = points[0];
  const last = points[points.length - 1];

  if (first.lng === last.lng && first.lat === last.lat) {
    return points.slice();
  }

  return [...points, first];
}

export function computeTelegramPolygonBBox(points: TelegramPolygonPoint[]): TelegramPolygonBBox {
  let minLng = points[0].lng;
  let maxLng = points[0].lng;
  let minLat = points[0].lat;
  let maxLat = points[0].lat;

  for (const point of points.slice(1)) {
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
  }

  return [minLng, minLat, maxLng, maxLat];
}

export function toTelegramPolygonGeoJSON(points: TelegramPolygonPoint[]): TelegramPolygonGeoJSON {
  const ring = closeTelegramPolygonRing(points).map(({ lng, lat }) => [lng, lat]);
  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

export function encodeTelegramPolygonPayload(points: readonly TelegramPolygonPoint[]): string {
  return JSON.stringify(points);
}

function failure(
  code: TelegramPolygonPayloadError["code"],
  message: string,
): TelegramPolygonPayloadFailure {
  return {
    ok: false,
    error: { code, message },
  };
}

function parsePayloadShape(payload: unknown): TelegramPolygonPayloadShape | null {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (
    payload && typeof payload === "object" &&
    Array.isArray((payload as { points?: unknown }).points)
  ) {
    return { points: (payload as { points: TelegramPolygonPoint[] }).points };
  }

  return null;
}

function normalizePoints(rawPoints: unknown[]): TelegramPolygonPayloadResult {
  if (rawPoints.length < 3) {
    return failure("too_few_points", "Polygon payload must include at least 3 points.");
  }

  const points: TelegramPolygonPoint[] = [];

  for (const rawPoint of rawPoints) {
    if (!isTelegramPolygonPoint(rawPoint)) {
      return failure(
        "invalid_shape",
        "Polygon points must be objects with numeric lng and lat values.",
      );
    }

    if (!Number.isFinite(rawPoint.lng) || !Number.isFinite(rawPoint.lat)) {
      return failure("non_finite_coordinate", "Polygon coordinates must be finite numbers.");
    }

    points.push({ lng: rawPoint.lng, lat: rawPoint.lat });
  }

  const polygon = toTelegramPolygonGeoJSON(points);
  const bbox = computeTelegramPolygonBBox(points);

  return {
    ok: true,
    points,
    polygon,
    bbox,
  };
}

export function parseTelegramPolygonPayload(payload: string): TelegramPolygonPayloadResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    return failure("invalid_json", "Polygon payload must be valid JSON.");
  }

  const shape = parsePayloadShape(parsed);

  if (!shape) {
    return failure(
      "invalid_shape",
      "Polygon payload must be a JSON array of points or an object with a points array.",
    );
  }

  const points = Array.isArray(shape) ? shape : shape.points;
  return normalizePoints(points);
}

export const parsePolygonWebAppPayload = parseTelegramPolygonPayload;
