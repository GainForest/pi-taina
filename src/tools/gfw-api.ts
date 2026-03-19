export interface GeostoreResult {
  hash: string;
  areaHa: number;
}

export interface TreeCoverYear {
  year: number;
  lossHa: number;
}

export interface TreeCoverResult {
  years: TreeCoverYear[];
  totalLossHa: number;
  latestYear: number;
}

export interface TreeExtentResult {
  areaHa: number;
  treeExtent2000Ha: number;
  treeExtent2010Ha: number;
  gainHa: number;
  lossHa: number;
}

export interface GfwError {
  success: false;
  error: string;
}

export interface FireAlert {
  date: string;
  confidence: string;
  count: number;
}

export interface FireAlertResult {
  success: true;
  alerts: FireAlert[];
  totalFires: number;
  period: string;
}

export interface DeforestationAlert {
  date: string;
  confidence: string;
  areaHa: number;
}

export interface DeforestationAlertResult {
  success: true;
  alerts: DeforestationAlert[];
  totalAreaHa: number;
  period: string;
}

const USER_AGENT = "Pi-Taina/1.0 (biodiversity-bot)";

export async function createGeostore(
  lat: number,
  lng: number,
  radiusKm: number
): Promise<GeostoreResult | GfwError> {
  const delta = radiusKm / 111.32;
  const body = {
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [lng - delta, lat - delta],
                [lng + delta, lat - delta],
                [lng + delta, lat + delta],
                [lng - delta, lat + delta],
                [lng - delta, lat - delta],
              ],
            ],
          },
        },
      ],
    },
  };

  let response: Response;
  try {
    response = await fetch("https://api.resourcewatch.org/v1/geostore", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${message}` };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `Geostore API returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse geostore response: ${message}` };
  }

  const d = data as { data?: { id?: string; attributes?: { areaHa?: number } } };
  const hash = d?.data?.id;
  const areaHa = d?.data?.attributes?.areaHa;

  if (typeof hash !== "string" || typeof areaHa !== "number") {
    return { success: false, error: "Unexpected geostore response shape" };
  }

  return { hash, areaHa };
}

export async function getTreeCoverLoss(
  apiKey: string,
  geostoreHash: string
): Promise<TreeCoverResult | GfwError> {
  const sql =
    "SELECT umd_tree_cover_loss__year, SUM(area__ha) as loss_ha FROM results WHERE umd_tree_cover_density_2000__threshold >= 30 GROUP BY umd_tree_cover_loss__year ORDER BY umd_tree_cover_loss__year";

  const params = new URLSearchParams({
    sql,
    geostore_id: geostoreHash,
    geostore_origin: "rw",
  });

  const url = `https://data-api.globalforestwatch.org/dataset/umd_tree_cover_loss/latest/query/json?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${message}` };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `GFW Data API returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse tree cover loss response: ${message}` };
  }

  const d = data as { data?: Array<{ umd_tree_cover_loss__year?: number; loss_ha?: number }> };
  if (!Array.isArray(d?.data)) {
    return { success: false, error: "Unexpected tree cover loss response shape" };
  }

  const years: TreeCoverYear[] = d.data.map((row) => ({
    year: row.umd_tree_cover_loss__year ?? 0,
    lossHa: row.loss_ha ?? 0,
  }));

  const totalLossHa = years.reduce((sum, y) => sum + y.lossHa, 0);
  const latestYear = years.length > 0 ? Math.max(...years.map((y) => y.year)) : 0;

  return { years, totalLossHa, latestYear };
}

export async function getTreeCoverExtent(
  geostoreHash: string
): Promise<TreeExtentResult | GfwError> {
  const params = new URLSearchParams({
    geostore: geostoreHash,
    period: "2001-01-01,2024-12-31",
    thresh: "30",
  });

  const url = `https://api.resourcewatch.org/v1/umd-loss-gain?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${message}` };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `RW API umd-loss-gain returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse tree extent response: ${message}` };
  }

  const d = data as {
    data?: {
      attributes?: {
        areaHa?: number;
        treeExtent?: number;
        treeExtent2010?: number;
        gain?: number;
        loss?: number;
      };
    };
  };

  const attrs = d?.data?.attributes;
  if (!attrs) {
    return { success: false, error: "Unexpected tree extent response shape" };
  }

  return {
    areaHa: attrs.areaHa ?? 0,
    treeExtent2000Ha: attrs.treeExtent ?? 0,
    treeExtent2010Ha: attrs.treeExtent2010 ?? 0,
    gainHa: attrs.gain ?? 0,
    lossHa: attrs.loss ?? 0,
  };
}

export async function getFireAlerts(
  apiKey: string,
  geostoreHash: string,
  days: number = 7
): Promise<FireAlertResult | GfwError> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString().slice(0, 10);
  const endDateStr = endDate.toISOString().slice(0, 10);

  const sql = `SELECT alert__date, confidence__cat, SUM(alert__count) as fires FROM results WHERE alert__date >= '${startDateStr}' GROUP BY alert__date, confidence__cat ORDER BY alert__date DESC LIMIT 100`;

  const params = new URLSearchParams({
    sql,
    geostore_id: geostoreHash,
    geostore_origin: "rw",
  });

  const url = `https://data-api.globalforestwatch.org/dataset/nasa_viirs_fire_alerts/latest/query/json?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${message}` };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `GFW Data API returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse fire alerts response: ${message}` };
  }

  const d = data as { data?: Array<{ alert__date?: string; confidence__cat?: string; fires?: number }> };
  if (!Array.isArray(d?.data)) {
    return { success: false, error: "Unexpected fire alerts response shape" };
  }

  const alerts: FireAlert[] = d.data.map((row) => ({
    date: row.alert__date ?? "",
    confidence: row.confidence__cat ?? "",
    count: row.fires ?? 0,
  }));

  const totalFires = alerts.reduce((sum, a) => sum + a.count, 0);

  return {
    success: true,
    alerts,
    totalFires,
    period: `${startDateStr} to ${endDateStr}`,
  };
}

export async function getDeforestationAlerts(
  apiKey: string,
  geostoreHash: string,
  days: number = 30
): Promise<DeforestationAlertResult | GfwError> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const startDateStr = startDate.toISOString().slice(0, 10);
  const endDateStr = endDate.toISOString().slice(0, 10);

  const sql = `SELECT gfw_integrated_alerts__date, gfw_integrated_alerts__confidence, SUM(area__ha) as area_ha FROM results WHERE gfw_integrated_alerts__date >= '${startDateStr}' GROUP BY gfw_integrated_alerts__date, gfw_integrated_alerts__confidence ORDER BY gfw_integrated_alerts__date DESC LIMIT 100`;

  const params = new URLSearchParams({
    sql,
    geostore_id: geostoreHash,
    geostore_origin: "rw",
  });

  const url = `https://data-api.globalforestwatch.org/dataset/gfw_integrated_alerts/latest/query/json?${params.toString()}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Network error: ${message}` };
  }

  if (!response.ok) {
    return {
      success: false,
      error: `GFW Data API returned HTTP ${response.status}: ${response.statusText}`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to parse deforestation alerts response: ${message}` };
  }

  const d = data as {
    data?: Array<{
      gfw_integrated_alerts__date?: string;
      gfw_integrated_alerts__confidence?: string;
      area_ha?: number;
    }>;
  };
  if (!Array.isArray(d?.data)) {
    return { success: false, error: "Unexpected deforestation alerts response shape" };
  }

  const alerts: DeforestationAlert[] = d.data.map((row) => ({
    date: row.gfw_integrated_alerts__date ?? "",
    confidence: row.gfw_integrated_alerts__confidence ?? "",
    areaHa: row.area_ha ?? 0,
  }));

  const totalAreaHa = alerts.reduce((sum, a) => sum + a.areaHa, 0);

  return {
    success: true,
    alerts,
    totalAreaHa,
    period: `${startDateStr} to ${endDateStr}`,
  };
}
