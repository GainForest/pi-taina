export type PolygonPoint = {
  lng: number;
  lat: number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function encodePolygonData(points: readonly PolygonPoint[]): string {
  return Buffer.from(JSON.stringify(points)).toString("base64");
}

export function buildPolygonWebAppUrl(
  baseUrl: string,
  preloadPolygon?: readonly PolygonPoint[],
): string {
  const url = new URL("/draw", normalizeBaseUrl(baseUrl));

  if (preloadPolygon !== undefined) {
    url.searchParams.set("data", encodePolygonData(preloadPolygon));
  }

  return url.toString();
}
