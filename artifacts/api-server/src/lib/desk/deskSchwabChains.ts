import { getBestAccessToken } from "../tokenStore.js";
import { deskFormatSchwabSymbol, deskIsIndex } from "./deskSchwabSymbol.js";
import { deskTouchFeed, deskMarkFeedError, deskMarkAuthFail } from "./deskFeedFreshness.js";
import { deskSessionDateEt } from "./deskEt.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const CACHE_TTL_MS = 30_000;

export type DeskChainNormalized = {
  symbol: string;
  expiration: string;
  strike: number;
  call_put: "call" | "put";
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  volume: number | null;
  open_interest: number | null;
  vendor_iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  quote_ts: string | null;
  trade_ts: string | null;
  mid: number | null;
  spread: number | null;
  spread_pct: number | null;
};

type CacheEntry = {
  underlyingPrice: number | null;
  raw: Record<string, unknown>[];
  normalized: DeskChainNormalized[];
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, expiration: string): string {
  return `${symbol.toUpperCase()}|${expiration}`;
}

function isoUtcFromLong(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return new Date(v).toISOString();
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeContract(raw: Record<string, unknown>): DeskChainNormalized | null {
  const occ = String(raw["symbol"] ?? "").trim();
  const putCall = String(raw["putCall"] ?? "").toUpperCase();
  const call_put: "call" | "put" = putCall === "P" || putCall === "PUT" ? "put" : "call";
  const strike = num(raw["strikePrice"]);
  const expiration = String(raw["expirationDate"] ?? "").slice(0, 10);
  if (!occ || strike == null || !expiration) return null;

  const bid = num(raw["bid"]);
  const ask = num(raw["ask"]);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : num(raw["mark"]);
  const spread = bid != null && ask != null ? ask - bid : null;
  const spread_pct = spread != null && mid != null && mid > 0 ? spread / mid : null;

  return {
    symbol: occ,
    expiration,
    strike,
    call_put,
    bid,
    ask,
    last: num(raw["last"]),
    mark: num(raw["mark"]),
    volume: num(raw["totalVolume"]),
    open_interest: num(raw["openInterest"]),
    vendor_iv: num(raw["volatility"]),
    delta: num(raw["delta"]),
    gamma: num(raw["gamma"]),
    theta: num(raw["theta"]),
    vega: num(raw["vega"]),
    quote_ts: isoUtcFromLong(raw["quoteTimeInLong"]),
    trade_ts: isoUtcFromLong(raw["tradeTimeInLong"]),
    mid,
    spread,
    spread_pct,
  };
}

function collectRawContracts(json: Record<string, unknown>, expiration: string): Record<string, unknown>[] {
  const expNorm = expiration.slice(0, 10);
  const out: Record<string, unknown>[] = [];
  for (const mapKey of ["callExpDateMap", "putExpDateMap"] as const) {
    const map = json[mapKey] as Record<string, unknown> | undefined;
    if (!map) continue;
    for (const expDate of Object.values(map)) {
      const strikeMap = expDate as Record<string, unknown>;
      for (const [, options] of Object.entries(strikeMap)) {
        const optionArr = options as Array<Record<string, unknown>>;
        for (const opt of optionArr) {
          const exp = String(opt["expirationDate"] ?? "").slice(0, 10);
          if (exp === expNorm) out.push(opt);
        }
      }
    }
  }
  return out;
}

async function fetchChainsFromSchwab(
  displaySymbol: string,
  expiration: string,
  token: string,
): Promise<CacheEntry | null> {
  const chainSymbol = deskIsIndex(displaySymbol)
    ? deskFormatSchwabSymbol(displaySymbol)
    : displaySymbol.toUpperCase();

  const params = new URLSearchParams({
    symbol: chainSymbol,
    contractType: "ALL",
    range: "NTM",
    strikeCount: "80",
    fromDate: expiration,
    toDate: expiration,
  });

  const url = `${SCHWAB_API_BASE}/chains?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 401) {
    deskMarkAuthFail("schwab_chains");
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json()) as Record<string, unknown>;
  const raw = collectRawContracts(json, expiration);
  const normalized = raw.map(normalizeContract).filter((x): x is DeskChainNormalized => x != null);

  return {
    underlyingPrice: num(json["underlyingPrice"]),
    raw,
    normalized,
    fetchedAt: Date.now(),
  };
}

export async function deskFetchSchwabChain(
  symbol: string,
  expiration: string,
): Promise<{
  underlyingPrice: number | null;
  raw: Record<string, unknown>[];
  normalized: DeskChainNormalized[];
  asOfMs: number;
  session_date: string;
}> {
  const sym = symbol.toUpperCase().trim();
  const exp = expiration.slice(0, 10);
  const session_date = deskSessionDateEt();
  const key = cacheKey(sym, exp);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    deskTouchFeed("schwab_chains", hit.fetchedAt);
    return {
      underlyingPrice: hit.underlyingPrice,
      raw: hit.raw,
      normalized: hit.normalized,
      asOfMs: hit.fetchedAt,
      session_date,
    };
  }

  const token = getBestAccessToken();
  if (!token) {
    deskMarkAuthFail("schwab_chains");
    return { underlyingPrice: null, raw: [], normalized: [], asOfMs: Date.now(), session_date };
  }

  const entry = await fetchChainsFromSchwab(sym, exp, token);
  if (!entry) {
    deskMarkFeedError("schwab_chains", "schwab_chain_fetch_failed");
    return { underlyingPrice: null, raw: [], normalized: [], asOfMs: Date.now(), session_date };
  }

  cache.set(key, entry);
  deskTouchFeed("schwab_chains", entry.fetchedAt);
  return {
    underlyingPrice: entry.underlyingPrice,
    raw: entry.raw,
    normalized: entry.normalized,
    asOfMs: entry.fetchedAt,
    session_date,
  };
}