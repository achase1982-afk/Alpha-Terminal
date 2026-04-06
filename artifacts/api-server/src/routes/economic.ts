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
  const json = await res.json() as Record<string, any>;
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
  nfp:              { id: "CES0000000001", label: "Headline NFP",                  unit: "thousands" },
  unemployment:     { id: "LNS14000000",   label: "Unemployment Rate (U-3)",       unit: "percent" },
  earningsMom:      { id: "CES0500000003", label: "Avg Hourly Earnings",           unit: "dollars" },
  lfpr:             { id: "LNS11300000",   label: "Labor Force Part. Rate",        unit: "percent" },
  weeklyHours:      { id: "CES0500000002", label: "Avg Weekly Hours",              unit: "hours" },
  privatePayroll:   { id: "CES0500000001", label: "Private Payrolls",              unit: "thousands" },
  govPayroll:       { id: "CES9000000001", label: "Government",                    unit: "thousands" },
  manufacturing:    { id: "CES3000000001", label: "Manufacturing",                 unit: "thousands" },
  leisureHosp:      { id: "CES7000000001", label: "Leisure & Hospitality",         unit: "thousands" },
  healthCare:       { id: "CES6562000001", label: "Health Care",                   unit: "thousands" },
  construction:     { id: "CES2000000001", label: "Construction",                  unit: "thousands" },
  transportWare:    { id: "CES4300000001", label: "Transportation & Warehousing",  unit: "thousands" },
  financialAct:     { id: "CES5500000001", label: "Financial Activities",          unit: "thousands" },
  fedGov:           { id: "CES9091000001", label: "Federal Government",            unit: "thousands" },
  employed:         { id: "LNS12000000",   label: "Employed",                      unit: "thousands" },
  unemployed:       { id: "LNS13000000",   label: "Unemployed",                    unit: "thousands" },
  laborForce:       { id: "LNS11000000",   label: "Labor Force",                  unit: "thousands" },
  empPopRatio:      { id: "LNS12300000",   label: "Emp-Pop Ratio",                unit: "percent" },
  u6:               { id: "LNS13327709",   label: "U-6 Underemployment",          unit: "percent" },
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
  threeMonthAvg?: string;
  error?: string;
}

const nfpCache: { data: any | null; ts: number } = { data: null, ts: 0 };
const NFP_CACHE_TTL = 5 * 60 * 1000;

const nfpExpectedCache: { expected: string | null; ts: number } = { expected: null, ts: 0 };
const NFP_EXPECTED_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

const TE_INDICATOR_URLS: Record<string, string> = {
  nfp: "https://tradingeconomics.com/united-states/non-farm-payrolls",
  unemployment: "https://tradingeconomics.com/united-states/unemployment-rate",
  cpi: "https://tradingeconomics.com/united-states/consumer-price-index-cpi",
};

async function fetchTradingEconomicsForecast(indicator: string = "nfp"): Promise<string | null> {
  try {
    const url = TE_INDICATOR_URLS[indicator] || TE_INDICATOR_URLS.nfp;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    
    if (!res.ok) {
      logger.warn({ status: res.status }, "Trading Economics page fetch failed");
      return null;
    }
    
    const html = await res.text();
    
    const forecastMatch = html.match(/Forecast[^<]*?(-?\d+[\d,.]*)\s*K/i);
    if (forecastMatch) {
      const forecastStr = forecastMatch[1].replace(/,/g, "");
      const forecastNum = parseFloat(forecastStr);
      if (Number.isFinite(forecastNum)) {
        const forecastJobs = Math.round(forecastNum * 1000);
        const formatted = `${forecastJobs >= 0 ? "+" : ""}${forecastJobs.toLocaleString()}`;
        logger.info({ forecast: formatted, raw: forecastNum }, "Trading Economics NFP forecast extracted");
        return formatted;
      }
    }
    
    logger.warn("Could not extract forecast from Trading Economics HTML");
    return null;
  } catch (err: any) {
    logger.warn({ err }, "Failed to fetch Trading Economics forecast");
    return null;
  }
}

async function fetchBlsSeriesBatch(seriesIds: string[]): Promise<Record<string, BlsDataPoint[]>> {
  const res = await fetch("https://api.bls.gov/publicAPI/v1/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seriesid: seriesIds }),
  });
  if (!res.ok) throw new Error(`BLS batch API error: ${res.status}`);
  const json = await res.json() as Record<string, any>;
  if (json.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS API status: ${json.status} — ${JSON.stringify(json.message)}`);
  }
  const result: Record<string, BlsDataPoint[]> = {};
  for (const s of json.Results?.series ?? []) {
    result[s.seriesID] = s.data ?? [];
  }
  return result;
}

function formatNfpValue(val: number, unit: string): string {
  if (unit === "thousands") return `${Math.round(val).toLocaleString()}K`;
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
    return { change: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts`, changeRaw: diff };
  }
  if (unit === "dollars") {
    const diff = val - prev;
    return { change: `${diff >= 0 ? "+$" : "-$"}${Math.abs(diff).toFixed(2)}`, changeRaw: diff };
  }
  const diff = val - prev;
  return { change: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}`, changeRaw: diff };
}

function computeNMonthAvg(monthly: BlsDataPoint[], n: number, unit: string): string | undefined {
  if (monthly.length < n + 1) return undefined;
  const changes: number[] = [];
  for (let i = 0; i < n && i + 1 < monthly.length; i++) {
    changes.push(parseFloat(monthly[i].value) - parseFloat(monthly[i + 1].value));
  }
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  if (unit === "thousands") return `${avg >= 0 ? "+" : ""}${Math.round(avg * 1000).toLocaleString()}`;
  if (unit === "percent") return `${avg.toFixed(1)}%`;
  return `${avg.toFixed(1)}`;
}

function generateNfpNarrative(data: Record<string, any>): string {
  const nfp = data.nfp;
  if (!nfp || nfp.error) return "";
  const change = nfp.changeRaw as number;
  const absChange = Math.abs(change).toLocaleString();
  const direction = change >= 0 ? "added" : "shed";
  const parts: string[] = [];
  parts.push(`Economy ${direction} ${absChange} jobs in ${nfp.month}`);
  if (data.unemployment && !data.unemployment.error) {
    const uRate = data.unemployment.actual;
    const uChange = data.unemployment.changeRaw;
    if (uChange < 0) parts.push(`unemployment fell to ${uRate}`);
    else if (uChange > 0) parts.push(`unemployment rose to ${uRate}`);
    else parts.push(`unemployment held at ${uRate}`);
  }
  if (data.earningsMom && !data.earningsMom.error) {
    const wc = data.earningsMom.changeRaw;
    parts.push(`wages ${wc > 0 ? "up" : wc < 0 ? "down" : "flat"} ${data.earningsMom.change} MoM`);
  }
  if (data.lfpr && !data.lfpr.error && data.lfpr.changeRaw !== 0) {
    parts.push(`participation ${data.lfpr.changeRaw > 0 ? "rose" : "fell"} to ${data.lfpr.actual}`);
  }
  const sectorKeys = ["healthCare", "leisureHosp", "construction", "transportWare", "manufacturing", "financialAct", "fedGov"];
  const sectors = sectorKeys
    .filter(k => data[k] && !data[k].error && data[k].changeRaw !== 0)
    .sort((a, b) => Math.abs(data[b].changeRaw) - Math.abs(data[a].changeRaw));
  if (sectors.length > 0) {
    const top = data[sectors[0]];
    parts.push(`led by ${(top.label as string).toLowerCase()} (${top.change})`);
  }
  return parts.join("; ") + ".";
}

router.get("/nfp-full", async (req, res) => {
  try {
    if (nfpCache.data && Date.now() - nfpCache.ts < NFP_CACHE_TTL) {
      return res.json(nfpCache.data);
    }

    const allSeriesIds = Object.values(NFP_SERIES).map(s => s.id);
    const allData = await fetchBlsSeriesBatch(allSeriesIds);

    const results: Record<string, any> = {};

    for (const [key, series] of Object.entries(NFP_SERIES)) {
      try {
        const data = allData[series.id] ?? [];
        const monthly = data.filter((d) => d.period.startsWith("M"));
        if (monthly.length < 2) {
          results[key] = { label: series.label, unit: series.unit, actual: "N/A", previous: "N/A", change: "N/A", changeRaw: 0, month: "", year: "", error: "insufficient data" };
          continue;
        }
        const cur = parseFloat(monthly[0].value);
        const prev = parseFloat(monthly[1].value);
        if (!Number.isFinite(cur) || !Number.isFinite(prev)) {
          results[key] = { label: series.label, unit: series.unit, actual: "N/A", previous: "N/A", change: "N/A", changeRaw: 0, month: monthly[0].periodName, year: monthly[0].year, error: "invalid data" };
          continue;
        }
        const { change, changeRaw } = computeNfpChange(cur, prev, series.unit);
        results[key] = {
          label: series.label,
          unit: series.unit,
          actual: formatNfpValue(cur, series.unit),
          previous: formatNfpValue(prev, series.unit),
          change,
          changeRaw,
          month: monthly[0].periodName,
          year: monthly[0].year,
          threeMonthAvg: computeNMonthAvg(monthly, 3, series.unit),
        };
      } catch (err: any) {
        results[key] = { label: series.label, unit: series.unit, actual: "N/A", previous: "N/A", change: "N/A", changeRaw: 0, month: "", year: "", error: err.message };
      }
    }

    const earningsData = allData[NFP_SERIES.earningsMom.id] ?? [];
    const earningsMonthly = earningsData.filter(d => d.period.startsWith("M"));
    if (earningsMonthly.length >= 13) {
      const cur = parseFloat(earningsMonthly[0].value);
      const yearAgo = parseFloat(earningsMonthly[12].value);
      const prevCur = earningsMonthly.length >= 14 ? parseFloat(earningsMonthly[1].value) : NaN;
      const prevYearAgo = earningsMonthly.length >= 14 ? parseFloat(earningsMonthly[13].value) : NaN;
      if (Number.isFinite(cur) && Number.isFinite(yearAgo) && yearAgo > 0) {
        const yoyPct = ((cur - yearAgo) / yearAgo) * 100;
        let prevYoyStr = "N/A";
        if (Number.isFinite(prevCur) && Number.isFinite(prevYearAgo) && prevYearAgo > 0) {
          prevYoyStr = `${(((prevCur - prevYearAgo) / prevYearAgo) * 100).toFixed(1)}%`;
        }
        results.earningsYoy = {
          label: "Avg Hourly Earnings YoY",
          unit: "percent",
          actual: `${yoyPct.toFixed(1)}%`,
          previous: prevYoyStr,
          change: `${yoyPct >= 0 ? "+" : ""}${yoyPct.toFixed(1)}%`,
          changeRaw: yoyPct,
          month: earningsMonthly[0].periodName,
          year: earningsMonthly[0].year,
        };
      }
    }

    const nfpRawData = allData[NFP_SERIES.nfp.id] ?? [];
    const nfpMonthly = nfpRawData.filter(d => d.period.startsWith("M"));

    const prevMonths: Array<{ month: string; change: string; changeRaw: number }> = [];
    for (let i = 1; i < Math.min(3, nfpMonthly.length); i++) {
      if (i + 1 < nfpMonthly.length) {
        const v = parseFloat(nfpMonthly[i].value);
        const pv = parseFloat(nfpMonthly[i + 1].value);
        if (!Number.isFinite(v) || !Number.isFinite(pv)) continue;
        const diff = Math.round(v - pv);
        prevMonths.push({
          month: nfpMonthly[i].periodName,
          change: `${diff >= 0 ? "+" : ""}${(diff * 1000).toLocaleString()}`,
          changeRaw: diff * 1000,
        });
      }
    }

    // Fetch Trading Economics expected value (cached for 6 hours)
    let expected: string | null = null;
    if (!nfpExpectedCache.expected || Date.now() - nfpExpectedCache.ts > NFP_EXPECTED_CACHE_TTL) {
      expected = await fetchTradingEconomicsForecast("nfp");
      if (expected) {
        nfpExpectedCache.expected = expected;
        nfpExpectedCache.ts = Date.now();
      }
    } else {
      expected = nfpExpectedCache.expected;
    }

    // Add expected to nfp result
    if (expected && results.nfp && !results.nfp.error) {
      results.nfp.expected = expected;
    }

    results._meta = {
      month: results.nfp?.month || "",
      year: results.nfp?.year || "",
      earningsYoy: results.earningsYoy || null,
      threeMonthNfpAvg: computeNMonthAvg(nfpMonthly, 3, "thousands"),
      sixMonthNfpAvg: computeNMonthAvg(nfpMonthly, 6, "thousands"),
      prevMonths,
      narrative: generateNfpNarrative(results),
      expectedNfp: expected,
    };

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
