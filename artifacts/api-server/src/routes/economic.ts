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

    let summary = "";
    if (change && monthlyData.length >= 2) {
      const cur = parseFloat(monthlyData[0].value);
      const prev = parseFloat(monthlyData[1].value);
      if (reportType === "nfp") {
        const diff = Math.round(cur - prev);
        const diffFull = Math.abs(diff * 1000).toLocaleString();
        const direction = diff >= 0 ? "added" : "lost";
        summary = `The economy ${direction} ${diffFull} jobs in ${latest.periodName}. Total nonfarm payrolls: ${Math.round(cur * 1000).toLocaleString()}. Previous month: ${Math.round(prev * 1000).toLocaleString()}.`;
      } else if (reportType === "unemployment") {
        const direction = cur > prev ? "rose" : cur < prev ? "fell" : "held steady at";
        summary = `The unemployment rate ${direction === "held steady at" ? direction : `${direction} to`} ${cur.toFixed(1)}% in ${latest.periodName}${direction !== "held steady at" ? `, from ${prev.toFixed(1)}% the prior month` : ""}.`;
      } else if (reportType === "cpi") {
        const pctChange = ((cur - prev) / prev) * 100;
        const direction = pctChange >= 0 ? "rose" : "fell";
        summary = `Consumer prices ${direction} ${Math.abs(pctChange).toFixed(1)}% in ${latest.periodName}. The CPI index stands at ${cur.toFixed(1)}, compared to ${prev.toFixed(1)} the prior month.`;
      } else if (reportType === "ppi") {
        const pctChange = ((cur - prev) / prev) * 100;
        const direction = pctChange >= 0 ? "rose" : "fell";
        summary = `Producer prices ${direction} ${Math.abs(pctChange).toFixed(1)}% in ${latest.periodName}. The PPI final demand index is at ${cur.toFixed(1)}, versus ${prev.toFixed(1)} previously.`;
      } else if (reportType === "earnings") {
        const direction = cur > prev ? "increased" : cur < prev ? "decreased" : "were unchanged";
        summary = `Average hourly earnings ${direction} to $${cur.toFixed(2)} in ${latest.periodName}, from $${prev.toFixed(2)} the prior month.`;
      }
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
      summary,
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

const NFP_SERIES: Record<string, { id: string; label: string; unit: string }> = {
  nfp:           { id: "CES0000000001", label: "Headline NFP",            unit: "thousands" },
  unemployment:  { id: "LNS14000000",   label: "Unemployment Rate (U-3)", unit: "percent" },
  earningsMom:   { id: "CES0500000003", label: "Avg Hourly Earnings",     unit: "dollars" },
  lfpr:          { id: "LNS11300000",   label: "Labor Force Participation Rate", unit: "percent" },
  weeklyHours:   { id: "CES0500000002", label: "Avg Weekly Hours",        unit: "hours" },
  privatePayroll:{ id: "CES0500000001", label: "Total Private Payrolls",  unit: "thousands" },
  manufacturing: { id: "CES3000000001", label: "Manufacturing Payrolls",  unit: "thousands" },
  leisureHosp:   { id: "CES7000000001", label: "Leisure & Hospitality",   unit: "thousands" },
  govPayroll:    { id: "CES9000000001", label: "Government Payrolls",     unit: "thousands" },
};

interface NfpSeriesResult {
  label: string;
  unit: string;
  actual: string;
  previous: string;
  change: string;
  changeRaw: number;
  month: string;
  year: string;
  error?: string;
}

const nfpCache: { data: Record<string, NfpSeriesResult> | null; ts: number } = { data: null, ts: 0 };
const NFP_CACHE_TTL = 5 * 60 * 1000;

function formatNfpValue(val: number, unit: string, includeSign = false): string {
  if (unit === "thousands") {
    const rounded = Math.round(val);
    const prefix = includeSign && rounded > 0 ? "+" : includeSign && rounded < 0 ? "" : "";
    return `${prefix}${rounded.toLocaleString()}K`;
  }
  if (unit === "percent") return `${val.toFixed(1)}%`;
  if (unit === "dollars") return `$${val.toFixed(2)}`;
  if (unit === "hours") return val.toFixed(1);
  return String(val);
}

function computeNfpChange(val: number, prev: number, unit: string): { change: string; changeRaw: number } {
  if (unit === "thousands") {
    const diff = Math.round(val - prev);
    return { change: `${diff >= 0 ? "+" : ""}${(diff * 1000).toLocaleString()}`, changeRaw: diff * 1000 };
  }
  if (unit === "percent") {
    const diff = val - prev;
    return { change: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}pp`, changeRaw: diff };
  }
  if (unit === "dollars") {
    const diff = val - prev;
    return { change: `${diff >= 0 ? "+$" : "-$"}${Math.abs(diff).toFixed(2)}`, changeRaw: diff };
  }
  const diff = val - prev;
  return { change: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}`, changeRaw: diff };
}

router.get("/nfp-full", async (req, res) => {
  try {
    if (nfpCache.data && Date.now() - nfpCache.ts < NFP_CACHE_TTL) {
      return res.json(nfpCache.data);
    }

    const results: Record<string, NfpSeriesResult> = {};

    const fetches = Object.entries(NFP_SERIES).map(async ([key, series]) => {
      try {
        const data = await fetchBlsSeries(series.id);
        const monthly = data.filter((d) => d.period.startsWith("M"));
        if (monthly.length < 2) {
          results[key] = { label: series.label, unit: series.unit, actual: "N/A", previous: "N/A", change: "N/A", changeRaw: 0, month: "", year: "" };
          return;
        }
        const cur = parseFloat(monthly[0].value);
        const prev = parseFloat(monthly[1].value);
        const { change, changeRaw } = computeNfpChange(cur, prev, series.unit);

        const r: NfpSeriesResult = {
          label: series.label,
          unit: series.unit,
          actual: formatNfpValue(cur, series.unit),
          previous: formatNfpValue(prev, series.unit),
          change,
          changeRaw,
          month: monthly[0].periodName,
          year: monthly[0].year,
        };

        results[key] = r;
      } catch (err: any) {
        results[key] = { label: series.label, unit: series.unit, actual: "N/A", previous: "N/A", change: "N/A", changeRaw: 0, month: "", year: "", error: err.message };
      }
    });

    await Promise.all(fetches);
    nfpCache.data = results;
    nfpCache.ts = Date.now();

    return res.json(results);
  } catch (err: any) {
    logger.error({ err }, "NFP full report fetch failed");
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
