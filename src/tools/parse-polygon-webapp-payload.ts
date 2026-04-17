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

const NUMBER_RE = "-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?";

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

function stripWrappedPolygonText(payload: string): string {
  const trimmed = payload.trim();

  const fenced = trimmed.match(/^```(?:json|text|txt)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    return fenced[1].trim();
  }

  return trimmed;
}

function extractJsonLikeText(payload: string): string {
  const text = stripWrappedPolygonText(payload);
  const firstBracket = text.search(/[\[{]/);
  const lastBracket = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));

  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return text.slice(firstBracket, lastBracket + 1).trim();
  }

  return text;
}

function parseTextNumber(value: string): number {
  return Number(value);
}

function parsePolygonCoordinateLine(line: string): PolygonPoint | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const labeledLngLat = trimmed.match(
    new RegExp(`(?:lng|lon|longitude)\\s*[:=]?\\s*(${NUMBER_RE}).*?(?:lat|latitude)\\s*[:=]?\\s*(${NUMBER_RE})`, "i")
  );
  if (labeledLngLat) {
    const lng = parseTextNumber(labeledLngLat[1]);
    const lat = parseTextNumber(labeledLngLat[2]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { lng, lat };
    }
  }

  const labeledLatLng = trimmed.match(
    new RegExp(`(?:lat|latitude)\\s*[:=]?\\s*(${NUMBER_RE}).*?(?:lng|lon|longitude)\\s*[:=]?\\s*(${NUMBER_RE})`, "i")
  );
  if (labeledLatLng) {
    const lat = parseTextNumber(labeledLatLng[1]);
    const lng = parseTextNumber(labeledLatLng[2]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { lng, lat };
    }
  }

  const barePair = trimmed.match(new RegExp(`(${NUMBER_RE})\\s*[,;\\s]+\\s*(${NUMBER_RE})`));
  if (!barePair) {
    return null;
  }

  const first = parseTextNumber(barePair[1]);
  const second = parseTextNumber(barePair[2]);

  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }

  // Prefer the common lng/lat ordering, but accept lat/lng when the range makes it obvious.
  const firstLooksLikeLng = Math.abs(first) <= 180;
  const secondLooksLikeLat = Math.abs(second) <= 90;
  const firstLooksLikeLat = Math.abs(first) <= 90;
  const secondLooksLikeLng = Math.abs(second) <= 180;

  if (firstLooksLikeLng && secondLooksLikeLat) {
    return { lng: first, lat: second };
  }

  if (firstLooksLikeLat && secondLooksLikeLng) {
    return { lng: second, lat: first };
  }

  return null;
}

function parseCoordinateText(payload: string): ParsePolygonWebAppPayloadResult | null {
  const points: PolygonPoint[] = [];
  let sawCoordinateLine = false;

  for (const line of payload.split(/\r?\n/)) {
    const point = parsePolygonCoordinateLine(line);
    if (point) {
      sawCoordinateLine = true;
      points.push(point);
      continue;
    }

    const looksLikeCoordinateLine =
      /\b(?:lng|lon|longitude|lat|latitude)\b/i.test(line) ||
      /[-+]?\d+(?:\.\d+)?\s*[,;\s]+\s*[-+]?\d+(?:\.\d+)?/.test(line);

    if (looksLikeCoordinateLine) {
      return failure(
        "invalid_shape",
        "Polygon payload must contain coordinate lines with lng/lat values or parseable coordinate pairs."
      );
    }
  }

  if (!sawCoordinateLine) {
    return null;
  }

  return normalizePoints(points);
}

export function isLikelyPolygonPayloadText(payload: string): boolean {
  const text = payload.trim();
  if (!text) {
    return false;
  }

  const looksJsonish = /[{}\[\]]/.test(text);
  if (looksJsonish && !/^```/m.test(text)) {
    return false;
  }

  const coordinatePairMatches = text.match(/[-+]?\d+(?:\.\d+)?\s*[,;\s]+\s*[-+]?\d+(?:\.\d+)?/g)?.length ?? 0;

  return (
    /^```/m.test(text) ||
    /\b(points?|polygon|lng|lat|longitude|latitude)\b/i.test(text) ||
    (!/[{}\[\]]/.test(text) && coordinatePairMatches >= 3)
  );
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
    parsed = JSON.parse(extractJsonLikeText(payload));
  } catch {
    const coordinateTextResult = isLikelyPolygonPayloadText(payload) ? parseCoordinateText(payload) : null;
    if (coordinateTextResult) {
      return coordinateTextResult;
    }

    return failure("invalid_json", "Polygon payload must be valid JSON or parseable coordinate text.");
  }

  const shape = parsePayloadShape(parsed);

  if (!shape) {
    const coordinateTextResult = isLikelyPolygonPayloadText(payload) ? parseCoordinateText(payload) : null;
    if (coordinateTextResult) {
      return coordinateTextResult;
    }

    return failure(
      "invalid_shape",
      "Polygon payload must be a JSON array of points, an object with a points array, or coordinate text.",
    );
  }

  const points = Array.isArray(shape) ? shape : shape.points;
  return normalizePoints(points);
}
