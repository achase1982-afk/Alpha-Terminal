import { getBestAccessToken } from "./tokenStore.js";

const SCHWAB_MARKETDATA = "https://api.schwabapi.com/marketdata/v1";

/**
 * Matches {@link ./schwabDynamicScreener.ts} batching — Schwab documents a limit on
 * comma-separated symbols per `/quotes` request; chunks avoid oversized URLs.
 */
export const SCHWAB_QUOTES_BATCH_SIZE = 50;

/** Parsed subset of Schwab `/quotes` for scanner Layer 2 card population. */
export interface SchwabScannerBatchQuote {
  price: number | null;
  changeAbs: number | null;
  changePct: number | null;
  volume: number | null;
  avgVolume20d: number | null;
  dayRange: { low: number; high: number } | null;
  name: string | null;
  sector: string | null;
}

function pickFiniteNum(obj: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function parseSchwabQuoteEntry(entry: Record<string, unknown> | undefined): SchwabScannerBatchQuote | null {
  if (!entry) return null;
  const q = entry["quote"] as Record<string, unknown> | undefined;
  const f = entry["fundamental"] as Record<string, unknown> | undefined;
  const ref = entry["reference"] as Record<string, unknown> | undefined;
  if (!q) return null;

  const last = pickFiniteNum(q, ["lastPrice", "last", "mark", "markPrice", "regularMarketLastPrice"]);
  const prevClose = pickFiniteNum(q, ["closePrice", "close", "previousClose", "regularMarketPreviousClose"]);

  let changeAbs = pickFiniteNum(q, [
    "netChange",
    "regularMarketNetChange",
    "markChange",
    "extendedChange",
    "postMarketChange",
    "preMarketChange",
  ]);
  let changePct = pickFiniteNum(q, [
    "netPercentChange",
    "futurePercentChange",
    "netPercentChangeInDouble",
    "regularMarketPercentChangeInDouble",
    "markPercentChange",
    "extendedPercentChange",
    "postMarketPercentChange",
    "preMarketPercentChange",
  ]);

  if (changeAbs == null && last != null && prevClose != null && prevClose !== 0) {
    changeAbs = parseFloat((last - prevClose).toFixed(4));
  }
  if (changePct == null && changeAbs != null && prevClose != null && prevClose !== 0) {
    changePct = parseFloat(((changeAbs / prevClose) * 100).toFixed(4));
  }

  const volume = pickFiniteNum(q, ["totalVolume", "volume"]);
  const avgVolume20d = pickFiniteNum(f, [
    "avg10DaysVolume",
    "avgVol10Days",
    "averageVolume10Day",
    "averageVolume",
  ]);

  const high = pickFiniteNum(q, ["highPrice", "dayHigh", "regularMarketHigh"]);
  const low = pickFiniteNum(q, ["lowPrice", "dayLow", "regularMarketLow"]);
  let dayRange: { low: number; high: number } | null = null;
  if (high != null && low != null && high > low) {
    dayRange = { low, high };
  }

  const nameRaw =
    (typeof ref?.["description"] === "string" && ref["description"].trim()) ||
    (typeof ref?.["companyName"] === "string" && ref["companyName"].trim()) ||
    (typeof q["description"] === "string" && q["description"].trim()) ||
    (typeof q["companyName"] === "string" && q["companyName"].trim()) ||
    null;

  const sectorRaw =
    typeof f?.["sector"] === "string" && f["sector"].trim() ? f["sector"].trim() : null;

  const price =
    last != null && Number.isFinite(last) && last > 0 ? last : null;

  return {
    price,
    changeAbs,
    changePct,
    volume,
    avgVolume20d,
    dayRange,
    name: nameRaw,
    sector: sectorRaw,
  };
}

/**
 * GET `https://api.schwabapi.com/marketdata/v1/quotes` with `fields=quote,fundamental,reference`.
 * Returns a map keyed by **uppercase** symbol. Omits symbols with no `quote` object or failed chunk.
 * Does not throw: failed batches are skipped; missing token yields an empty map.
 */
export async function fetchSchwabBatchQuotesForSymbols(
  symbols: string[],
  accessToken: string | null,
): Promise<Map<string, SchwabScannerBatchQuote>> {
  const out = new Map<string, SchwabScannerBatchQuote>();
  if (!accessToken || symbols.length === 0) return out;

  const orderedUnique: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    orderedUnique.push(s);
  }

  for (let i = 0; i < orderedUnique.length; i += SCHWAB_QUOTES_BATCH_SIZE) {
    const batch = orderedUnique.slice(i, i + SCHWAB_QUOTES_BATCH_SIZE);
    try {
      const res = await fetch(
        `${SCHWAB_MARKETDATA}/quotes?symbols=${encodeURIComponent(batch.join(","))}&fields=quote,fundamental,reference`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      for (const sym of batch) {
        const upper = sym.toUpperCase();
        const entry = (json[sym] ?? json[upper]) as Record<string, unknown> | undefined;
        const parsed = parseSchwabQuoteEntry(entry);
        if (parsed) out.set(upper, parsed);
      }
    } catch {
      continue;
    }
  }

  return out;
}

/** Uses {@link getBestAccessToken} — same session as other Schwab REST in this process. */
export async function fetchSchwabBatchQuotesForSymbolsBestToken(
  symbols: string[],
): Promise<Map<string, SchwabScannerBatchQuote>> {
  return fetchSchwabBatchQuotesForSymbols(symbols, getBestAccessToken());
}
