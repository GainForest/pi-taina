const USER_AGENT = "Pi-Taina/1.0 (biodiversity-bot)";

export async function generateTreeCoverLossChart(
  years: Array<{ year: number; lossHa: number }>,
  title?: string
): Promise<Buffer | null> {
  // Filter out zero-loss years
  const filtered = years.filter((y) => y.lossHa > 0);

  // Need at least 2 data points
  if (filtered.length < 2) {
    return null;
  }

  // Take last 10 years max
  const data = filtered.slice(-10);

  const chartConfig = {
    type: "bar",
    data: {
      labels: data.map((y) => String(y.year)),
      datasets: [
        {
          label: "Tree Cover Loss (ha)",
          data: data.map((y) => Math.round(y.lossHa)),
          backgroundColor: "rgba(228, 88, 62, 0.8)",
          borderColor: "rgba(228, 88, 62, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: title ?? "Tree Cover Loss",
        fontSize: 16,
      },
      legend: { display: false },
      scales: {
        yAxes: [
          {
            ticks: { beginAtZero: true },
            scaleLabel: { display: true, labelString: "Hectares" },
          },
        ],
        xAxes: [
          {
            scaleLabel: { display: true, labelString: "Year" },
          },
        ],
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  const url = `https://quickchart.io/chart?c=${encoded}&w=600&h=400&bkg=white`;

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  try {
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

export function buildGfwMapUrl(lat: number, lng: number, zoom?: number): string {
  const state = {
    center: { lat, lng },
    zoom: zoom ?? 10,
    canBound: false,
    datasets: [
      {
        dataset: "tree-cover-loss",
        layers: ["tree-cover-loss"],
        opacity: 1,
        visibility: true,
      },
    ],
  };

  const json = JSON.stringify(state);
  const encoded = Buffer.from(json).toString("base64");
  return `https://www.globalforestwatch.org/map/global/?map=${encoded}`;
}
