export interface GeocodeResult {
  success: true;
  latitude: number;
  longitude: number;
  formattedAddress: string;
  locality?: string;
  country?: string;
  countryCode?: string;
  stateProvince?: string;
}

export interface GeocodeError {
  success: false;
  error: string;
}

export type GeocodeResponse = GeocodeResult | GeocodeError;

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  country?: string;
  country_code?: string;
  state?: string;
  province?: string;
  region?: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimAddress;
}

export async function geocodeLocation(
  query: string,
  countryCode?: string
): Promise<GeocodeResponse> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    addressdetails: "1",
  });

  if (countryCode) {
    params.set("countrycodes", countryCode.toLowerCase());
  }

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Pi-Taina/1.0 (biodiversity-bot)",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${message}` };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `Nominatim returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let results: NominatimResult[];
  try {
    results = (await response.json()) as NominatimResult[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse response: ${message}` };
  }

  if (!Array.isArray(results) || results.length === 0) {
    return { success: false, error: `No results found for "${query}"` };
  }

  const first = results[0];
  const latitude = parseFloat(first.lat);
  const longitude = parseFloat(first.lon);

  if (isNaN(latitude) || isNaN(longitude)) {
    return { success: false, error: "Invalid coordinates in response" };
  }

  const addr = first.address ?? {};
  const locality =
    addr.city ?? addr.town ?? addr.village ?? addr.municipality;

  return {
    success: true,
    latitude,
    longitude,
    formattedAddress: first.display_name,
    ...(locality !== undefined && { locality }),
    ...(addr.country !== undefined && { country: addr.country }),
    ...(addr.country_code !== undefined && {
      countryCode: addr.country_code.toUpperCase(),
    }),
    ...(addr.state !== undefined
      ? { stateProvince: addr.state }
      : addr.province !== undefined
        ? { stateProvince: addr.province }
        : addr.region !== undefined
          ? { stateProvince: addr.region }
          : {}),
  };
}

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<GeocodeResponse> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: "json",
    addressdetails: "1",
    zoom: "14",
  });

  const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "Pi-Taina/1.0 (biodiversity-bot)" },
    });
  } catch (err) {
    return { success: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!response.ok) {
    return { success: false, error: `Nominatim HTTP ${response.status}: ${response.statusText}` };
  }

  let result: NominatimResult;
  try {
    result = (await response.json()) as NominatimResult;
  } catch (err) {
    return { success: false, error: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!result || !result.lat || !result.lon) {
    return { success: false, error: `No address found for ${latitude},${longitude}` };
  }

  const addr = result.address ?? {};
  const locality = addr.city ?? addr.town ?? addr.village ?? addr.municipality;

  return {
    success: true,
    latitude,
    longitude,
    formattedAddress: result.display_name,
    ...(locality !== undefined && { locality }),
    ...(addr.country !== undefined && { country: addr.country }),
    ...(addr.country_code !== undefined && { countryCode: addr.country_code.toUpperCase() }),
    ...(addr.state !== undefined
      ? { stateProvince: addr.state }
      : addr.province !== undefined
        ? { stateProvince: addr.province }
        : addr.region !== undefined
          ? { stateProvince: addr.region }
          : {}),
  };
}
