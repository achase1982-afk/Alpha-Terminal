import { deskFormatSchwabSymbol, deskIsIndex } from "./deskSchwabSymbol.js";
import { deskTouchFeed, deskMarkFeedError, deskMarkAuthFail } from "./deskFeedFreshness.js";
import {
  type DeskSchwabRestApp,
  type DeskSchwabRestFetchResult,
  type DeskSchwabRestResolution,
  deskSchwabMarkApp2AuthFailure,
  deskSchwabRestFetchWithResolution,
  deskSchwabRestResolve,
} from "./deskSchwabRestCredential.js";
import { deskSessionDateEt } from "./deskEt.js";
import { logger } from "../logger.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const CACHE_TTL_MS = 30_000;

function deskSchwabChainHealthSource(app: DeskSchwabRestApp): string {
  return app === "app2" ? "schwab_rest_2" : "schwab";
}

function deskTouchSchwabChainsFromApp(app: DeskSchwabRestApp, ts: number): void {
  deskTouchFeed("schwab_chains", ts, deskSchwabChainHealthSource(app));
}

const VALID_RANGES = new Set(["ALL", "ITM", "NTM", "OTM"]);

export type DeskChainQueryOpts = {
  strikeCount?: number;
  range?: string;
};

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
  rho: number | null;
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
  truncated: boolean;
  contract_count: number;
  app: DeskSchwabRestApp;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, expiration: string, opts?: DeskChainQueryOpts): string {
  const r = opts?.range ?? "ALL";
  const sc = opts?.strikeCount ?? "full";
  return `${symbol.toUpperCase()}|${expiration}|${r}|${sc}`;
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
    rho: num(raw["rho"]),
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

function chainParams(
  chainSymbol: string,
  expiration: string,
  contractType: "ALL" | "CALL" | "PUT",
  opts?: DeskChainQueryOpts,
): URLSearchParams {
  const range = opts?.range && VALID_RANGES.has(opts.range.toUpperCase())
    ? opts.range.toUpperCase()
    : "ALL";
  const params = new URLSearchParams({
    symbol: chainSymbol,
    contractType,
    range,
    fromDate: expiration,
    toDate: expiration,
  });
  if (opts?.strikeCount != null && opts.strikeCount > 0) {
    params.set("strikeCount", String(opts.strikeCount));
  }
  return params;
}

async function fetchChainUrlResolved(
  resolved: DeskSchwabRestResolution,
  url: string,
): Promise<{ json: Record<string, unknown> | null; app: DeskSchwabRestApp }> {
  const fetched = await deskSchwabRestFetchWithResolution(
    resolved,
    url,
    { headers: { Accept: "application/json" } },
    45_000,
  );
  const { res, app, token } = fetched;
  if (!token) {
    return { json: null, app };
  }
  if (res.status === 401) {
    if (app === "app1") deskMarkAuthFail("schwab_chains");
    else deskSchwabMarkApp2AuthFailure(res.status);
    return { json: null, app };
  }
  if (!res.ok) {
    deskMarkFeedError("schwab_chains", `chain_http_${res.status}`, deskSchwabChainHealthSource(app));
    logger.debug({ status: res.status, app }, "Desk Schwab chain HTTP failed");
    return { json: null, app };
  }
  return { json: (await res.json()) as Record<string, unknown>, app };
}

async function fetchChainsFromSchwab(
  displaySymbol: string,
  expiration: string,
  resolution: DeskSchwabRestResolution,
  opts?: DeskChainQueryOpts,
): Promise<CacheEntry | null> {
  const preferred = resolution.preferred;
  const chainSymbol = deskIsIndex(displaySymbol)
    ? deskFormatSchwabSymbol(displaySymbol)
    : displaySymbol.toUpperCase();

  const clientLimited = Boolean(
    opts?.strikeCount != null || (opts?.range && opts.range.toUpperCase() !== "ALL"),
  );

  const useSplit = deskIsIndex(displaySymbol) || displaySymbol.toUpperCase() === "SPX";

  let json: Record<string, unknown> | null = null;
  let raw: Record<string, unknown>[] = [];
  let underlyingPrice: number | null = null;
  let usedApp: DeskSchwabRestApp = preferred;

  if (useSplit) {
    const callParams = chainParams(chainSymbol, expiration, "CALL", opts);
    const putParams = chainParams(chainSymbol, expiration, "PUT", opts);
    usedApp = resolution.app;
    if (!resolution.token) return null;
    const [callR, putR] = await Promise.all([
      fetchChainUrlResolved(resolution, `${SCHWAB_API_BASE}/chains?${callParams}`),
      fetchChainUrlResolved(resolution, `${SCHWAB_API_BASE}/chains?${putParams}`),
    ]);
    usedApp = putR.app;
    if (!callR.json && !putR.json) return null;
    const callRaw = collectRawContracts(callR.json ?? {}, expiration);
    const putRaw = collectRawContracts(putR.json ?? {}, expiration);
    raw = [...callRaw, ...putRaw];
    underlyingPrice =
      num(callR.json?.["underlyingPrice"]) ?? num(putR.json?.["underlyingPrice"]);
    json = callR.json ?? putR.json;
  } else {
    const params = chainParams(chainSymbol, expiration, "ALL", opts);
    usedApp = resolution.app;
    const one = await fetchChainUrlResolved(resolution, `${SCHWAB_API_BASE}/chains?${params}`);
    usedApp = one.app;
    if (!one.json) return null;
    json = one.json;
    raw = collectRawContracts(json, expiration);
    underlyingPrice = num(json["underlyingPrice"]);
  }

  const normalized = raw.map(normalizeContract).filter((x): x is DeskChainNormalized => x != null);

  return {
    underlyingPrice,
    raw,
    normalized,
    fetchedAt: Date.now(),
    truncated: clientLimited,
    contract_count: raw.length,
    app: usedApp,
  };
}

export async function deskFetchSchwabChain(
  symbol: string,
  expiration: string,
  opts?: DeskChainQueryOpts,
  preferred: DeskSchwabRestApp = "app2",
): Promise<{
  underlyingPrice: number | null;
  raw: Record<string, unknown>[];
  normalized: DeskChainNormalized[];
  asOfMs: number;
  session_date: string;
  truncated: boolean;
  contract_count: number;
  app: DeskSchwabRestApp;
  fellBack: boolean;
}> {
  const sym = symbol.toUpperCase().trim();
  const exp = expiration.slice(0, 10);
  const session_date = deskSessionDateEt();
  const key = cacheKey(sym, exp, opts);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    deskTouchSchwabChainsFromApp(hit.app, hit.fetchedAt);
    return {
      underlyingPrice: hit.underlyingPrice,
      raw: hit.raw,
      normalized: hit.normalized,
      asOfMs: hit.fetchedAt,
      session_date,
      truncated: hit.truncated,
      contract_count: hit.contract_count,
      app: hit.app,
      fellBack: hit.app !== preferred,
    };
  }

  const resolved = await deskSchwabRestResolve(preferred);
  const entry = await fetchChainsFromSchwab(sym, exp, resolved, opts);
  if (!entry) {
    const usedApp = resolved.app;
    if (!resolved.token) {
      return {
        underlyingPrice: null,
        raw: [],
        normalized: [],
        asOfMs: Date.now(),
        session_date,
        truncated: false,
        contract_count: 0,
        app: usedApp,
        fellBack: resolved.fellBack,
      };
    }
    deskMarkFeedError("schwab_chains", "schwab_chain_fetch_failed", deskSchwabChainHealthSource(usedApp));
    return {
      underlyingPrice: null,
      raw: [],
      normalized: [],
      asOfMs: Date.now(),
      session_date,
      truncated: false,
      contract_count: 0,
      app: usedApp,
      fellBack: resolved.fellBack,
    };
  }

  const app = entry.app;
  const fellBack = app !== preferred;
  cache.set(key, entry);
  deskTouchSchwabChainsFromApp(app, entry.fetchedAt);
  return {
    underlyingPrice: entry.underlyingPrice,
    raw: entry.raw,
    normalized: entry.normalized,
    asOfMs: entry.fetchedAt,
    session_date,
    truncated: entry.truncated,
    contract_count: entry.contract_count,
    app,
    fellBack,
  };
}
