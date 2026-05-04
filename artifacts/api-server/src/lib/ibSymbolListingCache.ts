import { LIQUID_CORE_SYMBOLS, type LiquidCorePrimaryListing } from "../data/liquidCore130.js";
import { logger } from "./logger.js";

const POLYGON_API = "https://api.polygon.io";

/** Cached listing classification for TotalView gating (NASDAQ venue only). */
const listingCache = new Map<string, LiquidCorePrimaryListing | "OTHER_US" | null>();

function liquidCoreEntry(symbol: string) {
  const u = symbol.toUpperCase();
  return LIQUID_CORE_SYMBOLS.find((e) => e.symbol === u);
}

function polygonCodeToListing(code: string | undefined | null): LiquidCorePrimaryListing | "OTHER_US" | null {
  if (!code || typeof code !== "string") return null;
  const c = code.toUpperCase();
  if (c.includes("NASDAQ") || c === "XNMS" || c === "XNGS" || c === "FINR") return "NASDAQ";
  if (c === "ARCA" || c.includes("ARCA")) return "ARCA";
  if (c.includes("AMEX") || c === "NYSE MKT" || c === "XASE") return "AMEX";
  if (c.includes("NYSE")) return "NYSE";
  return "OTHER_US";
}

function schwabHintToListing(hint: string | undefined | null): LiquidCorePrimaryListing | "OTHER_US" | null {
  if (!hint || typeof hint !== "string") return null;
  return polygonCodeToListing(hint);
}

async function fetchPolygonPrimaryExchange(ticker: string): Promise<string | null> {
  const key = process.env["POLYGON_API_KEY"];
  const sym = ticker.toUpperCase().trim().replace(/^\$/, "");
  if (!key || !sym) return null;
  try {
    const url = `${POLYGON_API}/v3/reference/tickers/${encodeURIComponent(sym)}?apiKey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: { primary_exchange?: string } };
    const ex = json.results?.primary_exchange;
    return typeof ex === "string" && ex.length > 0 ? ex : null;
  } catch (err) {
    logger.debug({ err, sym }, "ibSymbolListingCache: Polygon ticker lookup failed");
    return null;
  }
}

/**
 * Resolve primary listing for NASDAQ TotalView subscription eligibility.
 * LC130 verified NASDAQ → NASDAQ without network.
 * LC130 with null primary or unknown symbol → Schwab hint, then Polygon, cached.
 */
export async function resolveEquityListingForTotalview(
  ticker: string,
  opts: { schwabExchangeHint?: string | null },
): Promise<LiquidCorePrimaryListing | "OTHER_US" | null> {
  const upper = ticker.toUpperCase().trim();
  const hit = listingCache.get(upper);
  if (hit !== undefined) return hit;

  const lc = liquidCoreEntry(upper);
  if (lc?.primaryListing === "NASDAQ") {
    listingCache.set(upper, "NASDAQ");
    return "NASDAQ";
  }
  if (lc?.primaryListing === "NYSE" || lc?.primaryListing === "ARCA" || lc?.primaryListing === "AMEX") {
    listingCache.set(upper, lc.primaryListing);
    return lc.primaryListing;
  }

  const fromSchwab = schwabHintToListing(opts.schwabExchangeHint ?? null);
  if (fromSchwab != null) {
    listingCache.set(upper, fromSchwab);
    return fromSchwab;
  }

  const polyEx = await fetchPolygonPrimaryExchange(upper);
  const fromPoly = polygonCodeToListing(polyEx);
  listingCache.set(upper, fromPoly);
  return fromPoly;
}

export function isNasdaqPrimaryListing(
  v: LiquidCorePrimaryListing | "OTHER_US" | null | undefined,
): boolean {
  return v === "NASDAQ";
}
