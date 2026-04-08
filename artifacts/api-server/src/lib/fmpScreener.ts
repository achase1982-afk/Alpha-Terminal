import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";

const FMP_BASE = "https://financialmodelingprep.com/api/v3";

export interface ScreenFilters {
  marketCapMin?: number;
  marketCapMax?: number;
  volumeMin?: number;
  priceMin?: number;
  priceMax?: number;
  sectors?: string[];
  sectorsExclude?: string[];
  exchange?: string;
  optionsVolumeMin?: number;
  country?: string;
  maxResults?: number;
}

interface FmpScreenerResult {
  symbol: string;
  companyName: string;
  marketCap: number;
  sector: string;
  industry: string;
  price: number;
  volume: number;
  exchange: string;
  country: string;
}

export async function runFmpScreen(filters: ScreenFilters): Promise<{ symbols: string[]; error?: string }> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return { symbols: [], error: "FMP_API_KEY not configured" };
  }

  try {
    const params = new URLSearchParams();
    params.set("apikey", apiKey);

    if (filters.marketCapMin) params.set("marketCapMoreThan", String(filters.marketCapMin));
    if (filters.marketCapMax) params.set("marketCapLessThan", String(filters.marketCapMax));
    if (filters.volumeMin) params.set("volumeMoreThan", String(filters.volumeMin));
    if (filters.priceMin) params.set("priceMoreThan", String(filters.priceMin));
    if (filters.priceMax) params.set("priceLessThan", String(filters.priceMax));
    if (filters.country) params.set("country", filters.country);
    else params.set("country", "US");

    if (filters.exchange) {
      if (filters.exchange === "NYSE") params.set("exchange", "NYSE");
      else if (filters.exchange === "NASDAQ") params.set("exchange", "NASDAQ");
    }

    if (filters.sectors && filters.sectors.length > 0) {
      params.set("sector", filters.sectors.join(","));
    }

    const limit = filters.maxResults ?? 200;
    params.set("limit", String(limit));

    const url = `${FMP_BASE}/stock-screener?${params.toString()}`;
    logger.info({ url: url.replace(apiKey, "***") }, "FMP screener request");

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error({ status: res.status, body: text }, "FMP screener error");
      void logFailure("FMP_SCREENER", "ERROR", `FMP API returned ${res.status}`, { body: text });
      return { symbols: [], error: `FMP API error: ${res.status}` };
    }

    const data = (await res.json()) as FmpScreenerResult[];
    if (!Array.isArray(data)) {
      return { symbols: [], error: "FMP returned unexpected format" };
    }

    let results = data;

    if (filters.sectorsExclude && filters.sectorsExclude.length > 0) {
      const excl = new Set(filters.sectorsExclude.map(s => s.toLowerCase()));
      results = results.filter(r => !excl.has((r.sector || "").toLowerCase()));
    }

    const symbols = results.map(r => r.symbol).filter(s => !s.includes(".") && !s.includes("-"));

    logger.info({ matched: symbols.length, filters }, "FMP screener results");
    return { symbols };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "FMP screener failed");
    void logFailure("FMP_SCREENER", "ERROR", `FMP screener failed: ${msg}`);
    return { symbols: [], error: msg };
  }
}
