export type PolygonPoint = {
  lng: number;
  lat: number;
};

export type PolygonBBox = [number, number, number, number];

export type PolygonGeoJSON = {
  type: "Polygon";
  coordinates: number[][][];
};

export type ParsePolygonWebAppPayloadError = {
  code:
    | "invalid_json"
    | "invalid_shape"
    | "too_few_points"
    | "non_finite_coordinate";
  message: string;
};

export type ParsePolygonWebAppPayloadSuccess = {
  ok: true;
  points: PolygonPoint[];
  polygon: PolygonGeoJSON;
  bbox: PolygonBBox;
};

export type ParsePolygonWebAppPayloadFailure = {
  ok: false;
  error: ParsePolygonWebAppPayloadError;
};

export type ParsePolygonWebAppPayloadResult =
  | ParsePolygonWebAppPayloadSuccess
  | ParsePolygonWebAppPayloadFailure;

type PolygonPayloadShape = PolygonPoint[] | { points: PolygonPoint[] };

export function isPolygonPoint(value: unknown): value is PolygonPoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybePoint = value as Record<string, unknown>;
  return typeof maybePoint.lng === "number" && typeof maybePoint.lat === "number";
}

export function closePolygonRing(points: PolygonPoint[]): PolygonPoint[] {
  if (points.length === 0) return [];

  const first = points[0];
  const last = points[points.length - 1];

  if (first.lng === last.lng && first.lat === last.lat) {
    return points.slice();
  }

  return [...points, first];
}

export function computePolygonBBox(points: PolygonPoint[]): PolygonBBox {
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

export function toPolygonGeoJSON(points: PolygonPoint[]): PolygonGeoJSON {
  const ring = closePolygonRing(points).map(({ lng, lat }) => [lng, lat]);
  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

function failure(
  code: ParsePolygonWebAppPayloadError["code"],
  message: string,
): ParsePolygonWebAppPayloadFailure {
  return {
    ok: false,
    error: { code, message },
  };
}

function parsePayloadShape(payload: unknown): PolygonPayloadShape | null {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as { points?: unknown }).points)) {
    return { points: (payload as { points: PolygonPoint[] }).points };
  }

  return null;
}

function normalizePoints(rawPoints: unknown[]): ParsePolygonWebAppPayloadResult {
  if (rawPoints.length < 3) {
    return failure("too_few_points", "Polygon payload must include at least 3 points.");
  }

  const points: PolygonPoint[] = [];

  for (const rawPoint of rawPoints) {
    if (!isPolygonPoint(rawPoint)) {
      return failure("invalid_shape", "Polygon points must be objects with numeric lng and lat values.");
    }

    if (!Number.isFinite(rawPoint.lng) || !Number.isFinite(rawPoint.lat)) {
      return failure("non_finite_coordinate", "Polygon coordinates must be finite numbers.");
    }

    points.push({ lng: rawPoint.lng, lat: rawPoint.lat });
  }

  const polygon = toPolygonGeoJSON(points);
  const bbox = computePolygonBBox(points);

  return {
    ok: true,
    points,
    polygon,
    bbox,
  };
}

export function parsePolygonWebAppPayload(
  payload: string,
): ParsePolygonWebAppPayloadResult {
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
