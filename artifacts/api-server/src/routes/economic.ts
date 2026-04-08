import { Router } from "express";
import { logger } from "../lib/logger";
import * as fs from "fs";
import * as path from "path";

const router = Router();

const BLS_API_KEY = process.env.DATA_BLS || "";
const BLS_API_BASE = BLS_API_KEY
  ? "https://api.bls.gov/publicAPI/v2/timeseries/data"
  : "https://api.bls.gov/publicAPI/v1/timeseries/data";

const CACHE_DIR = path.join(process.cwd(), ".cache");
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

function loadDiskCache(key: string): any | null {
  try {
    const fp = path.join(CACHE_DIR, `${key}.json`);
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
      return raw;
    }
  } catch {}
  return null;
}

function saveDiskCache(key: string, data: any): void {
  try {
    const fp = path.join(CACHE_DIR, `${key}.json`);
    fs.writeFileSync(fp, JSON.stringify(data));
  } catch {}
}

const SERIES_MAP: Record<string, { id: string; label: string; unit: string }> = {
  nfp: { id: "CES0000000001", label: "Total Nonfarm Payrolls", unit: "thousands" },
  unemployment: { id: "LNS14000000", label: "Unemployment Rate", unit: "percent" },
  cpi: { id: "CUSR0000SA0", label: "CPI All Urban Consumers", unit: "index" },
  ppi: { id: "WPSFD49104", label: "PPI Final Demand", unit: "index" },
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
  const url = `${BLS_API_BASE}/${seriesId}${BLS_API_KEY ? `?registrationkey=${BLS_API_KEY}` : ""}`;
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

const nfpCacheDisk = loadDiskCache("nfp-full");
const nfpCache: { data: any | null; ts: number } = { data: nfpCacheDisk?.data || null, ts: nfpCacheDisk?.ts || 0 };
const NFP_CACHE_TTL = 5 * 60 * 1000;

const nfpExpectedCache: { expected: string | null; ts: number } = { expected: null, ts: 0 };
const NFP_EXPECTED_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

const TE_INDICATOR_URLS: Record<string, string> = {
  nfp: "https://tradingeconomics.com/united-states/non-farm-payrolls",
  unemployment: "https://tradingeconomics.com/united-states/unemployment-rate",
  cpi: "https://tradingeconomics.com/united-states/inflation-rate-mom",
  ppi: "https://tradingeconomics.com/united-states/producer-prices-change-mom",
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
    
    if (indicator === "nfp") {
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
    } else {
      const pctMatch = html.match(/Forecast[^<]*?(-?\d+\.?\d*)\s*%/i);
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1]);
        if (Number.isFinite(pct)) {
          const formatted = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
          logger.info({ forecast: formatted, indicator }, "Trading Economics forecast extracted");
          return formatted;
        }
      }
    }
    
    logger.warn({ indicator }, "Could not extract forecast from Trading Economics HTML");
    return null;
  } catch (err: any) {
    logger.warn({ err }, "Failed to fetch Trading Economics forecast");
    return null;
  }
}

async function fetchBlsSeriesBatch(seriesIds: string[]): Promise<Record<string, BlsDataPoint[]>> {
  const body: Record<string, any> = { seriesid: seriesIds };
  if (BLS_API_KEY) body.registrationkey = BLS_API_KEY;
  const res = await fetch(BLS_API_BASE + "/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

function computeNfpAtOffset(
  allData: Record<string, BlsDataPoint[]>,
  offset: number
): Record<string, any> {
  const monthResults: Record<string, any> = {};
  for (const [key, series] of Object.entries(NFP_SERIES)) {
    try {
      const data = allData[series.id] ?? [];
      const monthly = data.filter((d) => d.period.startsWith("M"));
      if (monthly.length < offset + 2) {
        monthResults[key] = { label: series.label, unit: series.unit, actual: "N/A", previous: "N/A", change: "N/A", changeRaw: 0, month: "", year: "", error: "insufficient data" };
        continue;
      }
      const cur = parseFloat(monthly[offset].value);
      const prev = parseFloat(monthly[offset + 1].value);
      if (!Number.isFinite(cur) || !Number.isFinite(prev)) {
        monthResults[key] = { label: series.label, unit: series.unit, actual: "N/A", previous: "N/A", change: "N/A", changeRaw: 0, month: monthly[offset].periodName, year: monthly[offset].year, error: "invalid data" };
        continue;
      }
      const { change, changeRaw } = computeNfpChange(cur, prev, series.unit);
      monthResults[key] = {
        label: series.label,
        unit: series.unit,
        actual: formatNfpValue(cur, series.unit),
        previous: formatNfpValue(prev, series.unit),
        change,
        changeRaw,
        month: monthly[offset].periodName,
        year: monthly[offset].year,
        threeMonthAvg: (offset === 0) ? computeNMonthAvg(monthly, 3, series.unit) : undefined,
      };
    } catch (err: any) {
      monthResults[key] = { label: series.label, unit: series.unit, actual: "N/A", previous: "N/A", change: "N/A", changeRaw: 0, month: "", year: "", error: err.message };
    }
  }

  const earningsData = allData[NFP_SERIES.earningsMom.id] ?? [];
  const earningsMonthly = earningsData.filter(d => d.period.startsWith("M"));
  if (earningsMonthly.length >= offset + 13) {
    const cur = parseFloat(earningsMonthly[offset].value);
    const yearAgo = parseFloat(earningsMonthly[offset + 12].value);
    const prevCur = earningsMonthly.length >= offset + 14 ? parseFloat(earningsMonthly[offset + 1].value) : NaN;
    const prevYearAgo = earningsMonthly.length >= offset + 14 ? parseFloat(earningsMonthly[offset + 13].value) : NaN;
    if (Number.isFinite(cur) && Number.isFinite(yearAgo) && yearAgo > 0) {
      const yoyPct = ((cur - yearAgo) / yearAgo) * 100;
      let prevYoyStr = "N/A";
      if (Number.isFinite(prevCur) && Number.isFinite(prevYearAgo) && prevYearAgo > 0) {
        prevYoyStr = `${(((prevCur - prevYearAgo) / prevYearAgo) * 100).toFixed(1)}%`;
      }
      monthResults.earningsYoy = {
        label: "Avg Hourly Earnings YoY",
        unit: "percent",
        actual: `${yoyPct.toFixed(1)}%`,
        previous: prevYoyStr,
        change: `${yoyPct >= 0 ? "+" : ""}${yoyPct.toFixed(1)}%`,
        changeRaw: yoyPct,
        month: earningsMonthly[offset].periodName,
        year: earningsMonthly[offset].year,
      };
    }
  }

  return monthResults;
}

router.get("/nfp-full", async (req, res) => {
  try {
    if (nfpCache.data && Date.now() - nfpCache.ts < NFP_CACHE_TTL) {
      return res.json(nfpCache.data);
    }

    const allSeriesIds = Object.values(NFP_SERIES).map(s => s.id);
    const allData = await fetchBlsSeriesBatch(allSeriesIds);

    const results = computeNfpAtOffset(allData, 0);

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

    let expected: string | null = null;
    if (!nfpExpectedCache.expected || Date.now() - nfpExpectedCache.ts > NFP_EXPECTED_CACHE_TTL) {
      const [nfpForecast, unempForecast] = await Promise.all([
        fetchTradingEconomicsForecast("nfp"),
        fetchTradingEconomicsForecast("unemployment"),
      ]);
      expected = nfpForecast;
      if (expected) {
        nfpExpectedCache.expected = expected;
        nfpExpectedCache.ts = Date.now();
      }
      if (unempForecast && results.unemployment && !results.unemployment.error) {
        results.unemployment.expected = unempForecast;
      }
    } else {
      expected = nfpExpectedCache.expected;
    }

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

    const byMonth: Record<string, Record<string, any>> = {};
    const maxMonths = Math.min(nfpMonthly.length - 1, 18);
    for (let offset = 0; offset < maxMonths; offset++) {
      const dp = nfpMonthly[offset];
      const key = periodToKey(dp);
      const monthData = computeNfpAtOffset(allData, offset);
      if (offset === 0 && expected && monthData.nfp && !monthData.nfp.error) {
        monthData.nfp.expected = expected;
      }
      monthData._meta = {
        month: dp.periodName,
        year: dp.year,
        threeMonthNfpAvg: computeNMonthAvg(nfpMonthly.slice(offset), 3, "thousands"),
        sixMonthNfpAvg: computeNMonthAvg(nfpMonthly.slice(offset), 6, "thousands"),
        narrative: generateNfpNarrative(monthData),
      };
      byMonth[key] = monthData;
    }
    results.byMonth = byMonth;

    nfpCache.data = results;
    nfpCache.ts = Date.now();
    saveDiskCache("nfp-full", { data: results, ts: nfpCache.ts });

    return res.json(results);
  } catch (err: any) {
    logger.error({ err }, "NFP full report fetch failed");
    if (nfpCache.data) {
      logger.info("Returning stale NFP cache after fetch failure");
      return res.json(nfpCache.data);
    }
    return res.status(500).json({ error: err.message });
  }
});

const PPI_FULL_SERIES: Record<string, { id: string; label: string }> = {
  headline: { id: "WPSFD49104", label: "PPI Final Demand" },
  core: { id: "WPSFD49116", label: "PPI ex Food/Energy/Trade" },
};

const CPI_FULL_SERIES: Record<string, { id: string; label: string }> = {
  headline: { id: "CUSR0000SA0", label: "CPI All Items" },
  core: { id: "CUSR0000SA0L1E", label: "Core CPI (ex Food & Energy)" },
  food: { id: "CUSR0000SAF1", label: "Food" },
  energy: { id: "CUSR0000SA0E", label: "Energy" },
  shelter: { id: "CUSR0000SAH1", label: "Shelter" },
  medical: { id: "CUSR0000SAM", label: "Medical Care" },
  transport: { id: "CUSR0000SAT", label: "Transportation" },
  apparel: { id: "CUSR0000SAA", label: "Apparel" },
  usedCars: { id: "CUSR0000SETA02", label: "Used Cars & Trucks" },
};

const ppiCacheDisk = loadDiskCache("ppi-full");
const ppiFullCache: { data: any | null; ts: number } = { data: ppiCacheDisk?.data || null, ts: ppiCacheDisk?.ts || 0 };
const cpiCacheDisk = loadDiskCache("cpi-full");
const cpiFullCache: { data: any | null; ts: number } = { data: cpiCacheDisk?.data || null, ts: cpiCacheDisk?.ts || 0 };
const INFLATION_CACHE_TTL = 30 * 60 * 1000;

function computeInflationResult(
  label: string,
  monthly: BlsDataPoint[],
  offset: number = 0
): Record<string, any> {
  if (monthly.length < offset + 3) return { label, error: "insufficient data" };

  const vals = monthly.map((d) => parseFloat(d.value));
  if (vals.slice(offset, offset + 3).some((v) => !Number.isFinite(v)))
    return { label, error: "invalid data" };

  const cur = vals[offset];
  const prev = vals[offset + 1];
  const prevPrev = vals[offset + 2];

  const mom = ((cur - prev) / prev) * 100;
  const prevMom = ((prev - prevPrev) / prevPrev) * 100;
  const diff = mom - prevMom;

  const result: Record<string, any> = {
    label,
    unit: "percent",
    actual: `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%`,
    previous: `${prevMom >= 0 ? "+" : ""}${prevMom.toFixed(1)}%`,
    change: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts`,
    changeRaw: diff,
    momRaw: mom,
    prevMomRaw: prevMom,
    month: monthly[offset].periodName,
    year: monthly[offset].year,
    level: cur.toFixed(1),
    prevLevel: prev.toFixed(1),
  };

  if (monthly.length >= offset + 13) {
    const yearAgo = vals[offset + 12];
    if (Number.isFinite(yearAgo) && yearAgo > 0) {
      const yoy = ((cur - yearAgo) / yearAgo) * 100;
      result.yoy = `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`;
      result.yoyRaw = yoy;
    }
  }
  if (monthly.length >= offset + 14) {
    const prevYearAgo = vals[offset + 13];
    if (Number.isFinite(prev) && Number.isFinite(prevYearAgo) && prevYearAgo > 0) {
      const prevYoy = ((prev - prevYearAgo) / prevYearAgo) * 100;
      result.prevYoy = `${prevYoy >= 0 ? "+" : ""}${prevYoy.toFixed(1)}%`;
      result.prevYoyRaw = prevYoy;
    }
  }

  return result;
}

function periodToKey(dp: BlsDataPoint): string {
  const m = parseInt(dp.period.replace("M", ""), 10);
  return `${dp.year}-${String(m).padStart(2, "0")}`;
}

function buildInflationByMonth(
  seriesEntries: [string, { id: string; label: string }][],
  allData: Record<string, BlsDataPoint[]>,
  headlineKey: string,
  reportUrl: string,
  reportType: string
): Record<string, any> {
  const results: Record<string, any> = {};

  for (const [key, series] of seriesEntries) {
    const data = allData[series.id] ?? [];
    const monthly = data.filter((d) => d.period.startsWith("M"));
    results[key] = computeInflationResult(series.label, monthly, 0);
  }

  const headlineRaw = allData[headlineKey] ?? [];
  const headlineMonthly = headlineRaw.filter((d) => d.period.startsWith("M"));
  const recentMom: Array<{ month: string; value: string; raw: number }> = [];
  for (let i = 0; i + 1 < Math.min(7, headlineMonthly.length); i++) {
    const c = parseFloat(headlineMonthly[i].value);
    const p = parseFloat(headlineMonthly[i + 1].value);
    if (Number.isFinite(c) && Number.isFinite(p) && p > 0) {
      const m = ((c - p) / p) * 100;
      recentMom.push({
        month: headlineMonthly[i].periodName,
        value: `${m >= 0 ? "+" : ""}${m.toFixed(1)}%`,
        raw: m,
      });
    }
  }

  results._meta = {
    month: results.headline?.month || "",
    year: results.headline?.year || "",
    recentMom,
    reportUrl,
  };

  const byMonth: Record<string, Record<string, any>> = {};
  const sampleMonthly = headlineMonthly;
  const maxMonths = Math.min(sampleMonthly.length - 2, 18);
  for (let offset = 0; offset < maxMonths; offset++) {
    const dp = sampleMonthly[offset];
    const key = periodToKey(dp);
    const monthData: Record<string, any> = {};
    for (const [seriesKey, series] of seriesEntries) {
      const data = allData[series.id] ?? [];
      const monthly = data.filter((d) => d.period.startsWith("M"));
      monthData[seriesKey] = computeInflationResult(series.label, monthly, offset);
    }
    monthData._meta = {
      month: dp.periodName,
      year: dp.year,
      reportUrl,
    };
    byMonth[key] = monthData;
  }
  results.byMonth = byMonth;

  return results;
}

router.get("/ppi-full", async (req, res) => {
  try {
    if (ppiFullCache.data && Date.now() - ppiFullCache.ts < INFLATION_CACHE_TTL) {
      return res.json(ppiFullCache.data);
    }

    const allIds = Object.values(PPI_FULL_SERIES).map((s) => s.id);
    const allData = await fetchBlsSeriesBatch(allIds);
    const seriesEntries = Object.entries(PPI_FULL_SERIES) as [string, { id: string; label: string }][];
    const results = buildInflationByMonth(seriesEntries, allData, PPI_FULL_SERIES.headline.id, "https://www.bls.gov/news.release/ppi.nr0.htm", "ppi");

    let expected: string | null = null;
    try {
      expected = await fetchTradingEconomicsForecast("ppi");
    } catch {}
    if (expected && results.headline && !results.headline.error) {
      const expNum = parseFloat(expected.replace(/[+%]/g, ""));
      if (Number.isFinite(expNum) && Math.abs(expNum - results.headline.momRaw) < 2) {
        results.headline.expected = expected;
        const latestKey = results._meta ? `${results._meta.year}-${String(new Date(`${results._meta.month} 1, ${results._meta.year}`).getMonth() + 1).padStart(2, "0")}` : null;
        if (latestKey && results.byMonth?.[latestKey]?.headline) {
          results.byMonth[latestKey].headline.expected = expected;
        }
      } else {
        logger.info({ expected, momRaw: results.headline.momRaw }, "PPI TE forecast skipped — likely YoY, not MoM");
      }
    }

    ppiFullCache.data = results;
    ppiFullCache.ts = Date.now();
    saveDiskCache("ppi-full", { data: results, ts: ppiFullCache.ts });
    return res.json(results);
  } catch (err: any) {
    logger.error({ err }, "PPI full report fetch failed");
    if (ppiFullCache.data) {
      logger.info("Returning stale PPI cache after fetch failure");
      return res.json(ppiFullCache.data);
    }
    return res.status(500).json({ error: err.message });
  }
});

router.get("/cpi-full", async (req, res) => {
  try {
    if (cpiFullCache.data && Date.now() - cpiFullCache.ts < INFLATION_CACHE_TTL) {
      return res.json(cpiFullCache.data);
    }

    const allIds = Object.values(CPI_FULL_SERIES).map((s) => s.id);
    const allData = await fetchBlsSeriesBatch(allIds);
    const seriesEntries = Object.entries(CPI_FULL_SERIES) as [string, { id: string; label: string }][];
    const results = buildInflationByMonth(seriesEntries, allData, CPI_FULL_SERIES.headline.id, "https://www.bls.gov/news.release/cpi.nr0.htm", "cpi");

    let expected: string | null = null;
    try {
      expected = await fetchTradingEconomicsForecast("cpi");
    } catch {}
    if (expected && results.headline && !results.headline.error) {
      const expNum = parseFloat(expected.replace(/[+%]/g, ""));
      if (Number.isFinite(expNum) && Math.abs(expNum - results.headline.momRaw) < 2) {
        results.headline.expected = expected;
        const latestKey = results._meta ? `${results._meta.year}-${String(new Date(`${results._meta.month} 1, ${results._meta.year}`).getMonth() + 1).padStart(2, "0")}` : null;
        if (latestKey && results.byMonth?.[latestKey]?.headline) {
          results.byMonth[latestKey].headline.expected = expected;
        }
      } else {
        logger.info({ expected, momRaw: results.headline.momRaw }, "CPI TE forecast skipped — likely YoY, not MoM");
      }
    }

    cpiFullCache.data = results;
    cpiFullCache.ts = Date.now();
    saveDiskCache("cpi-full", { data: results, ts: cpiFullCache.ts });
    return res.json(results);
  } catch (err: any) {
    logger.error({ err }, "CPI full report fetch failed");
    if (cpiFullCache.data) {
      logger.info("Returning stale CPI cache after fetch failure");
      return res.json(cpiFullCache.data);
    }
    return res.status(500).json({ error: err.message });
  }
});

const FOMC_SCHEDULE: Array<{
  year: number;
  month: number;
  startDay: number;
  endDay: number;
  hasSEP: boolean;
}> = [
  { year: 2024, month: 1, startDay: 30, endDay: 31, hasSEP: false },
  { year: 2024, month: 3, startDay: 19, endDay: 20, hasSEP: true },
  { year: 2024, month: 4, startDay: 30, endDay: 1, hasSEP: false },
  { year: 2024, month: 6, startDay: 11, endDay: 12, hasSEP: true },
  { year: 2024, month: 7, startDay: 30, endDay: 31, hasSEP: false },
  { year: 2024, month: 9, startDay: 17, endDay: 18, hasSEP: true },
  { year: 2024, month: 11, startDay: 6, endDay: 7, hasSEP: false },
  { year: 2024, month: 12, startDay: 17, endDay: 18, hasSEP: true },
  { year: 2025, month: 1, startDay: 28, endDay: 29, hasSEP: false },
  { year: 2025, month: 3, startDay: 18, endDay: 19, hasSEP: true },
  { year: 2025, month: 5, startDay: 6, endDay: 7, hasSEP: false },
  { year: 2025, month: 6, startDay: 17, endDay: 18, hasSEP: true },
  { year: 2025, month: 7, startDay: 29, endDay: 30, hasSEP: false },
  { year: 2025, month: 9, startDay: 16, endDay: 17, hasSEP: true },
  { year: 2025, month: 10, startDay: 28, endDay: 29, hasSEP: false },
  { year: 2025, month: 12, startDay: 9, endDay: 10, hasSEP: true },
  { year: 2026, month: 1, startDay: 27, endDay: 28, hasSEP: false },
  { year: 2026, month: 3, startDay: 17, endDay: 18, hasSEP: true },
  { year: 2026, month: 4, startDay: 28, endDay: 29, hasSEP: false },
  { year: 2026, month: 6, startDay: 16, endDay: 17, hasSEP: true },
  { year: 2026, month: 7, startDay: 28, endDay: 29, hasSEP: false },
  { year: 2026, month: 9, startDay: 15, endDay: 16, hasSEP: true },
  { year: 2026, month: 10, startDay: 27, endDay: 28, hasSEP: false },
  { year: 2026, month: 12, startDay: 8, endDay: 9, hasSEP: true },
  { year: 2027, month: 1, startDay: 26, endDay: 27, hasSEP: false },
  { year: 2027, month: 3, startDay: 16, endDay: 17, hasSEP: true },
  { year: 2027, month: 5, startDay: 4, endDay: 5, hasSEP: false },
  { year: 2027, month: 6, startDay: 15, endDay: 16, hasSEP: true },
  { year: 2027, month: 7, startDay: 27, endDay: 28, hasSEP: false },
  { year: 2027, month: 9, startDay: 21, endDay: 22, hasSEP: true },
  { year: 2027, month: 10, startDay: 26, endDay: 27, hasSEP: false },
  { year: 2027, month: 12, startDay: 14, endDay: 15, hasSEP: true },
];

const MONTH_NAMES_FOMC = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseFedFraction(s: string): number {
  s = s.replace(/\u2011/g, "-").replace(/\u2010/g, "-").trim();
  const m = s.match(/^(\d+)\s*[-–]\s*(\d+)\s*\/\s*(\d+)$/);
  if (m) return parseInt(m[1]) + parseInt(m[2]) / parseInt(m[3]);
  const m2 = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m2) return parseInt(m2[1]) / parseInt(m2[2]);
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function fmtStatementDate(y: number, m: number, d: number): string {
  return `${y}${m.toString().padStart(2, "0")}${d.toString().padStart(2, "0")}`;
}

interface FomcParsedStatement {
  rateLower: number;
  rateUpper: number;
  rateDisplay: string;
  action: string;
  vote: string;
  dissenters: string;
  keyExcerpt: string;
}

async function fetchAndParseStatement(dateStr: string): Promise<FomcParsedStatement | null> {
  try {
    const url = `https://www.federalreserve.gov/newsevents/pressreleases/monetary${dateStr}a.htm`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const rateMatch = html.match(/target\s+range\s+for\s+the\s+federal\s+funds\s+rate\s+(?:at\s+)?([\d\u2011\u2010\-/]+)\s+to\s+([\d\u2011\u2010\-/]+)\s+percent/i);
    if (!rateMatch) return null;

    const lower = parseFedFraction(rateMatch[1]);
    const upper = parseFedFraction(rateMatch[2]);
    if (isNaN(lower) || isNaN(upper)) return null;

    let action = "maintained";
    if (html.match(/decided\s+to\s+lower/i)) action = "lowered";
    else if (html.match(/decided\s+to\s+raise/i)) action = "raised";

    let vote = "";
    let dissenters = "";
    const voteSection = html.match(/Voting\s+for\s+the\s+monetary\s+policy\s+action\s+were\s+([\s\S]*?)(?=<\/p>|Voting\s+against)/i);
    if (voteSection) {
      const text = voteSection[1].replace(/<[^>]*>/g, "");
      const voterCount = (text.match(/;/g) || []).length + 1;

      const againstSection = html.match(/Voting\s+against\s+(?:the\s+)?(?:this\s+)?action\s+(?:was|were)\s+([\s\S]*?)(?:<\/p>)/i);
      if (againstSection) {
        const againstText = againstSection[1].replace(/<[^>]*>/g, "").replace(/\.\s*$/, "");
        const againstNames = againstText.split(/;/).map(s => s.replace(/^and\s+/i, "").trim()).filter(Boolean);
        vote = `${voterCount}-${againstNames.length}`;
        dissenters = againstNames.join(", ");
      } else {
        vote = `${voterCount}-0`;
      }
    }

    let keyExcerpt = "";
    const excerptMatch = html.match(/(?:economic\s+activity|economy)\s+(?:has\s+)?(?:continued\s+to\s+|appeared\s+to\s+)?(?:expand|grow|contract|slow|moderate)[^.]*\./i);
    if (excerptMatch) keyExcerpt = excerptMatch[0].trim();

    return {
      rateLower: lower,
      rateUpper: upper,
      rateDisplay: `${lower.toFixed(2)}-${upper.toFixed(2)}%`,
      action,
      vote,
      dissenters,
      keyExcerpt,
    };
  } catch (err: any) {
    logger.warn({ err, dateStr }, "Failed to fetch/parse Fed statement");
    return null;
  }
}

interface FomcMeetingResult {
  statementDate: string;
  meetingRange: string;
  year: number;
  month: number;
  hasSEP: boolean;
  statementUrl: string;
  minutesUrl: string;
  sepUrl: string | null;
  pressConferenceUrl: string;
  status: "upcoming" | "completed";
  rate: {
    lower: number;
    upper: number;
    display: string;
    action: string;
    changeBps: number;
    changeDisplay: string;
    vote: string;
    dissenters: string;
  } | null;
  keyExcerpt: string;
}

const fomcCache: { data: FomcMeetingResult[] | null; ts: number } = { data: null, ts: 0 };
const FOMC_CACHE_TTL = 60 * 60 * 1000;

router.get("/fomc-data", async (req, res) => {
  try {
    if (fomcCache.data && Date.now() - fomcCache.ts < FOMC_CACHE_TTL) {
      return res.json({ meetings: fomcCache.data });
    }

    const now = new Date();
    const results: FomcMeetingResult[] = [];

    const pastMeetings: Array<typeof FOMC_SCHEDULE[0] & { dateStr: string; statementDate: string }> = [];
    const allMeetings: Array<typeof FOMC_SCHEDULE[0] & { dateStr: string; statementDate: string }> = [];

    for (const mtg of FOMC_SCHEDULE) {
      const endMonth = mtg.endDay < mtg.startDay ? (mtg.month % 12) + 1 : mtg.month;
      const endYear = mtg.endDay < mtg.startDay && mtg.month === 12 ? mtg.year + 1 : mtg.year;
      const dateStr = fmtStatementDate(endYear, endMonth, mtg.endDay);
      const sd = `${endYear}-${endMonth.toString().padStart(2, "0")}-${mtg.endDay.toString().padStart(2, "0")}`;
      const entry = { ...mtg, dateStr, statementDate: sd };
      allMeetings.push(entry);
      const meetingDate = new Date(endYear, endMonth - 1, mtg.endDay);
      if (meetingDate <= now) pastMeetings.push(entry);
    }

    const recentPast = pastMeetings.slice(-12);
    const statementResults = new Map<string, FomcParsedStatement | null>();

    const fetchPromises = recentPast.map(async (mtg) => {
      const parsed = await fetchAndParseStatement(mtg.dateStr);
      statementResults.set(mtg.dateStr, parsed);
    });
    await Promise.all(fetchPromises);

    for (const mtg of allMeetings) {
      const endMonth = mtg.endDay < mtg.startDay ? (mtg.month % 12) + 1 : mtg.month;
      const endYear = mtg.endDay < mtg.startDay && mtg.month === 12 ? mtg.year + 1 : mtg.year;
      const meetingDate = new Date(endYear, endMonth - 1, mtg.endDay);
      const isPast = meetingDate <= now;

      const monthName = MONTH_NAMES_FOMC[mtg.month];
      const meetingRange = mtg.endDay < mtg.startDay
        ? `${monthName} ${mtg.startDay}-${MONTH_NAMES_FOMC[(mtg.month % 12) + 1]} ${mtg.endDay}, ${endYear}`
        : `${monthName} ${mtg.startDay}-${mtg.endDay}, ${mtg.year}`;

      const statementUrl = `https://www.federalreserve.gov/newsevents/pressreleases/monetary${mtg.dateStr}a.htm`;
      const minutesUrl = `https://www.federalreserve.gov/monetarypolicy/fomcminutes${mtg.dateStr}.htm`;
      const sepUrl = mtg.hasSEP ? `https://www.federalreserve.gov/monetarypolicy/fomcprojtabl${mtg.dateStr}.htm` : null;
      const pressConferenceUrl = `https://www.federalreserve.gov/monetarypolicy/fomcpresconf${mtg.dateStr}.htm`;

      let rate: FomcMeetingResult["rate"] = null;
      let keyExcerpt = "";

      if (isPast && statementResults.has(mtg.dateStr)) {
        const parsed = statementResults.get(mtg.dateStr);
        if (parsed) {
          rate = {
            lower: parsed.rateLower,
            upper: parsed.rateUpper,
            display: parsed.rateDisplay,
            action: parsed.action,
            changeBps: 0,
            changeDisplay: "",
            vote: parsed.vote,
            dissenters: parsed.dissenters,
          };
          keyExcerpt = parsed.keyExcerpt;
        }
      }

      results.push({
        statementDate: mtg.statementDate,
        meetingRange,
        year: mtg.year,
        month: mtg.month,
        hasSEP: mtg.hasSEP,
        statementUrl,
        minutesUrl,
        sepUrl,
        pressConferenceUrl,
        status: isPast ? "completed" : "upcoming",
        rate,
        keyExcerpt,
      });
    }

    for (let i = 1; i < results.length; i++) {
      const curRate = results[i].rate;
      if (!curRate) continue;
      const prev = results.slice(0, i).reverse().find(r => r.rate);
      if (prev && prev.rate) {
        const changeBps = Math.round((curRate.upper - prev.rate.upper) * 100);
        if (changeBps === 0) {
          curRate.changeDisplay = "UNCHANGED";
        } else if (changeBps < 0) {
          curRate.changeDisplay = `CUT ${Math.abs(changeBps)}bps`;
        } else {
          curRate.changeDisplay = `HIKE ${changeBps}bps`;
        }
        curRate.changeBps = changeBps;
      }
    }

    fomcCache.data = results;
    fomcCache.ts = Date.now();
    return res.json({ meetings: results });
  } catch (err: any) {
    logger.error({ err }, "FOMC data fetch failed");
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
