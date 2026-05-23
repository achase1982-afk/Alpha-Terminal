import pLimit from "p-limit";
import { getFmpApiKeyOrThrow, FMP_HTTP_CONCURRENCY } from "../fmpClient.js";

const FMP_STABLE_BASE = "https://financialmodelingprep.com/stable";
const profileLimit = pLimit(FMP_HTTP_CONCURRENCY);

export interface FmpCompanyProfile {
  symbol: string;
  marketCap: number | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  averageVolume: number | null;
}

function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function normaliseProfile(raw: Record<string, unknown>, fallbackSymbol: string): FmpCompanyProfile | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase() ?? fallbackSymbol.toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    marketCap: pickNumber(raw["marketCap"]) ?? pickNumber(raw["mktCap"]),
    sector: pickString(raw["sector"]),
    industry: pickString(raw["industry"]),
    description: pickString(raw["description"]),
    averageVolume: pickNumber(raw["averageVolume"]) ?? pickNumber(raw["volAvg"]),
  };
}

export async function fetchFmpCompanyProfile(symbol: string): Promise<FmpCompanyProfile | null> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return null;

  const apiKey = getFmpApiKeyOrThrow();
  const url = `${FMP_STABLE_BASE}/profile?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await profileLimit(() =>
    fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FMP profile ${sym} failed: HTTP ${res.status} ${text.slice(0, 160)}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  return normaliseProfile(first as Record<string, unknown>, sym);
}

/** One profile request per symbol (parallel, concurrency-capped). */
export async function fetchFmpCompanyProfiles(symbols: string[]): Promise<Map<string, FmpCompanyProfile>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  const out = new Map<string, FmpCompanyProfile>();

  await Promise.all(
    unique.map(async (sym) => {
      try {
        const profile = await fetchFmpCompanyProfile(sym);
        if (profile) out.set(sym, profile);
      } catch {
        // Omit symbol — micro-cap pass treats missing cap conservatively.
      }
    }),
  );

  return out;
}
