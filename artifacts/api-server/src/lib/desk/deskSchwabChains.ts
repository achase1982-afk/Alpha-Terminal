import { getBestAccessToken } from "../tokenStore.js";
import { deskFormatSchwabSymbol, deskIsIndex } from "./deskSchwabSymbol.js";
import { deskTouchFeed, deskMarkFeedError } from "./deskFeedFreshness.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const CACHE_TTL_MS = 30_000;

type ParsedContract = {
  strike: number;
  expiration: string;
  occ_symbol?: string;
  type: "call" | "put";
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  dte?: number;
};

type CacheEntry = {
  underlyingPrice?: number;
  contracts: ParsedContract[];
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, expiration: string): string {
  return `${symbol.toUpperCase()}|${expiration}`;
}

function parseSide(
  map: Record<string, unknown>,
  type: "call" | "put",
): ParsedContract[] {
  const out: ParsedContract[] = [];
  for (const expDate of Object.values(map)) {
    const strikeMap = expDate as Record<string, unknown>;
    for (const [, options] of Object.entries(strikeMap)) {
      const optionArr = options as Array<Record<string, unknown>>;
      for (const opt of optionArr) {
        const rawStrike = opt["strikePrice"] as number;
        const mark =
          typeof opt["mark"] === "number"
            ? (opt["mark"] as number)
            : typeof opt["markPrice"] === "number"
              ? (opt["markPrice"] as number)
              : undefined;
        out.push({
          strike: Math.round(rawStrike * 100) / 100,
          expiration: (opt["expirationDate"] as string) ?? "",
          occ_symbol: (opt["symbol"] as string | undefined)?.trim(),
          type,
          bid: opt["bid"] as number | undefined,
          ask: opt["ask"] as number | undefined,
          last: opt["last"] as number | undefined,
          mark,
          volume: opt["totalVolume"] as number | undefined,
          openInterest: opt["openInterest"] as number | undefined,
          iv: (() => {
            const v = opt["volatility"] as number | undefined;
            return v != null && v > 0 ? v : undefined;
          })(),
          delta: opt["delta"] as number | undefined,
          gamma: opt["gamma"] as number | undefined,
          theta: opt["theta"] as number | undefined,
          vega: opt["vega"] as number | undefined,
          dte: opt["daysToExpiration"] as number | undefined,
        });
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
  if (!res.ok) return null;

  const json = (await res.json()) as Record<string, unknown>;
  const calls = parseSide((json["callExpDateMap"] as Record<string, unknown>) ?? {}, "call");
  const puts = parseSide((json["putExpDateMap"] as Record<string, unknown>) ?? {}, "put");
  const expNorm = expiration.slice(0, 10);
  const contracts = [...calls, ...puts].filter((c) => c.expiration.slice(0, 10) === expNorm);

  return {
    underlyingPrice: json["underlyingPrice"] as number | undefined,
    contracts,
    fetchedAt: Date.now(),
  };
}

export async function deskFetchSchwabChain(
  symbol: string,
  expiration: string,
): Promise<{ underlying_price: number | null; contracts: ParsedContract[]; asOfMs: number }> {
  const sym = symbol.toUpperCase().trim();
  const exp = expiration.slice(0, 10);
  const key = cacheKey(sym, exp);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    deskTouchFeed("schwab_chains");
    return {
      underlying_price: hit.underlyingPrice ?? null,
      contracts: hit.contracts,
      asOfMs: hit.fetchedAt,
    };
  }

  const token = getBestAccessToken();
  if (!token) {
    deskMarkFeedError("schwab_chains", "no_schwab_token");
    return { underlying_price: null, contracts: [], asOfMs: Date.now() };
  }

  const entry = await fetchChainsFromSchwab(sym, exp, token);
  if (!entry) {
    deskMarkFeedError("schwab_chains", "schwab_chain_fetch_failed");
    return { underlying_price: null, contracts: [], asOfMs: Date.now() };
  }

  cache.set(key, entry);
  deskTouchFeed("schwab_chains");
  return {
    underlying_price: entry.underlyingPrice ?? null,
    contracts: entry.contracts,
    asOfMs: entry.fetchedAt,
  };
}