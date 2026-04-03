import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const BLS_API_V1 = "https://api.bls.gov/publicAPI/v1/timeseries/data";

const SERIES_MAP: Record<string, { id: string; label: string; unit: string }> = {
  nfp: { id: "CES0000000001", label: "Total Nonfarm Payrolls", unit: "thousands" },
  unemployment: { id: "LNS14000000", label: "Unemployment Rate", unit: "percent" },
  cpi: { id: "CUSR0000SA0", label: "CPI All Urban Consumers", unit: "index" },
  ppi: { id: "WPUFD49104", label: "PPI Final Demand", unit: "index" },
  earnings: { id: "CES0500000003", label: "Avg Hourly Earnings (Private)", unit: "dollars" },
};

interface BlsDataPoint {
  year: string;
  period: string;
  periodName: string;
  value: string;
  latest: string;
  footnotes: Array<{ code: string; text: string }>;
}

async function fetchBlsSeries(seriesId: string): Promise<BlsDataPoint[]> {
  const url = `${BLS_API_V1}/${seriesId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BLS API error: ${res.status}`);
  const json = await res.json();
  if (json.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS API status: ${json.status} — ${JSON.stringify(json.message)}`);
  }
  return json.Results?.series?.[0]?.data ?? [];
}

function computeChange(data: BlsDataPoint[], unit: string) {
  if (data.length < 2) return null;
  const current = parseFloat(data[0].value);
  const previous = parseFloat(data[1].value);
  if (isNaN(current) || isNaN(previous)) return null;

  if (unit === "thousands") {
    const change = current - previous;
    return {
      actual: `${change > 0 ? "+" : ""}${Math.round(change)}K`,
      actualRaw: Math.round(change * 1000),
      currentLevel: `${current.toLocaleString()}K`,
      previousLevel: `${previous.toLocaleString()}K`,
      previousMonth: data[1].periodName,
      currentMonth: data[0].periodName,
      currentYear: data[0].year,
    };
  } else if (unit === "percent") {
    return {
      actual: `${current.toFixed(1)}%`,
      actualRaw: current,
      previousLevel: `${previous.toFixed(1)}%`,
      previousMonth: data[1].periodName,
      currentMonth: data[0].periodName,
      currentYear: data[0].year,
    };
  } else if (unit === "index") {
    const pctChange = ((current - previous) / previous) * 100;
    return {
      actual: `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`,
      actualRaw: pctChange,
      currentLevel: current.toFixed(1),
      previousLevel: previous.toFixed(1),
      previousMonth: data[1].periodName,
      currentMonth: data[0].periodName,
      currentYear: data[0].year,
    };
  } else {
    return {
      actual: data[0].value,
      actualRaw: parseFloat(data[0].value),
      previousLevel: data[1].value,
      previousMonth: data[1].periodName,
      currentMonth: data[0].periodName,
      currentYear: data[0].year,
    };
  }
}

router.get("/report", async (req, res) => {
  try {
    const reportType = (req.query.type as string || "nfp").toLowerCase();
    const series = SERIES_MAP[reportType];
    if (!series) {
      return res.status(400).json({ error: `Unknown report type: ${reportType}. Available: ${Object.keys(SERIES_MAP).join(", ")}` });
    }

    const data = await fetchBlsSeries(series.id);
    if (!data.length) {
      return res.json({ error: "No data available", series: series.label });
    }

    const monthlyData = data.filter((d) => d.period.startsWith("M"));
    if (!monthlyData.length) {
      return res.json({ error: "No monthly data available", series: series.label, reportType });
    }
    const change = computeChange(monthlyData, series.unit);
    const latest = monthlyData[0];

    const recentHistory = monthlyData.slice(0, 6).map((d) => ({
      month: d.periodName,
      year: d.year,
      value: d.value,
    }));

    let reportUrl = "";
    if (reportType === "nfp" || reportType === "unemployment" || reportType === "earnings") {
      reportUrl = "https://www.bls.gov/news.release/empsit.nr0.htm";
    } else if (reportType === "cpi") {
      reportUrl = "https://www.bls.gov/news.release/cpi.nr0.htm";
    } else if (reportType === "ppi") {
      reportUrl = "https://www.bls.gov/news.release/ppi.nr0.htm";
    }

    return res.json({
      reportType,
      series: series.label,
      unit: series.unit,
      latest: {
        month: latest.periodName,
        year: latest.year,
        value: latest.value,
        isLatest: latest.latest === "true",
      },
      change,
      recentHistory,
      reportUrl,
    });
  } catch (err: any) {
    logger.error({ err }, "Economic report fetch failed");
    return res.status(500).json({ error: err.message || "Failed to fetch economic data" });
  }
});

router.get("/multi", async (req, res) => {
  try {
    const results: Record<string, any> = {};
    const fetches = Object.entries(SERIES_MAP).map(async ([key, series]) => {
      try {
        const data = await fetchBlsSeries(series.id);
        const monthlyData = data.filter((d) => d.period.startsWith("M"));
        const change = computeChange(monthlyData, series.unit);
        results[key] = {
          label: series.label,
          unit: series.unit,
          change,
          latest: monthlyData[0] ? {
            month: monthlyData[0].periodName,
            year: monthlyData[0].year,
            value: monthlyData[0].value,
          } : null,
        };
      } catch (err: any) {
        results[key] = { label: series.label, error: err.message };
      }
    });
    await Promise.all(fetches);
    return res.json(results);
  } catch (err: any) {
    logger.error({ err }, "Economic multi-report fetch failed");
    return res.status(500).json({ error: err.message });
  }
});

router.get("/bls-report", async (req, res) => {
  try {
    const reportType = (req.query.type as string || "nfp").toLowerCase();

    let url = "";
    if (reportType === "nfp" || reportType === "unemployment" || reportType === "earnings") {
      url = "https://www.bls.gov/news.release/empsit.nr0.htm";
    } else if (reportType === "cpi") {
      url = "https://www.bls.gov/news.release/cpi.nr0.htm";
    } else if (reportType === "ppi") {
      url = "https://www.bls.gov/news.release/ppi.nr0.htm";
    }

    if (!url) {
      return res.status(400).json({ error: "Unknown report type" });
    }

    const blsRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });

    if (!blsRes.ok) {
      return res.json({ url, error: `Could not load report (${blsRes.status}). Open directly.` });
    }

    let html = await blsRes.text();
    html = html.replace(/<head>/i, `<head><base href="https://www.bls.gov/" />`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    return res.send(html);
  } catch (err: any) {
    logger.error({ err }, "BLS report proxy failed");
    return res.json({ error: err.message || "Failed to load report" });
  }
});

export default router;
