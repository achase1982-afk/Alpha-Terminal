import { appendPolygonApiTraceRecord } from "./polygonApiTrace.js";
import { addCalendarDaysNy, nyCalendarYmd } from "./polygonMarketCalendar.js";

interface PolygonOptionResult {
  day?: {
    volume?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    previous_close?: number;
  };
  details?: {
    contract_type?: string;
    expiration_date?: string;
    strike_price?: number;
    ticker?: string;
  };
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
  };
  implied_volatility?: number;
  last_quote?: {
    ask?: number;
    ask_size?: number;
    bid?: number;
    bid_size?: number;
  };
  last_trade?: {
    price?: number;
  };
  open_interest?: number;
  underlying_asset?: {
    price?: number;
  };
}

interface PolygonSnapshotPage {
  results?: PolygonOptionResult[];
  status?: string;
  next_url?: string;
}

export interface PolygonParsedContract {
  strike: number;
  expiration: string;
  schwabSymbol?: string;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  dte?: number;
}

export interface PolygonChainResult {
  calls: PolygonParsedContract[];
  puts: PolygonParsedContract[];
  underlyingPrice?: number;
  /** Raw option rows returned by Polygon before parse filtering (diagnostics). */
  rawContractsFetched?: number;
}

function polygonTickerToSchwabSymbol(polygonTicker: string): string {
  const inner = polygonTicker.startsWith("O:") ? polygonTicker.slice(2) : polygonTicker;
  const match = inner.match(/^([A-Z ./]+?)(\d{6}[CP]\d{8})$/);
  if (!match) return inner;
  const [, root, rest] = match;
  return `${root.trim().padEnd(6, " ")}${rest}`;
}

function normalizeExpirationYmd(expirationDate: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(expirationDate.trim());
  return m ? m[1]! : expirationDate.trim().slice(0, 10);
}

function computeDte(expirationDate: string): number {
  const ymd = normalizeExpirationYmd(expirationDate);
  const now = new Date();
  const exp = new Date(`${ymd}T20:00:00Z`);
  return Math.max(0, Math.round((exp.getTime() - now.getTime()) / 86_400_000));
}

function parseResults(results: PolygonOptionResult[]): {
  calls: PolygonParsedContract[];
  puts: PolygonParsedContract[];
  underlyingPrice?: number;
} {
  const calls: PolygonParsedContract[] = [];
  const puts: PolygonParsedContract[] = [];
  let underlyingPrice: number | undefined;

  for (const r of results) {
    if (!r.details?.strike_price || !r.details.expiration_date || !r.details.contract_type) continue;

    const ctype = String(r.details.contract_type).trim().toLowerCase();
    if (ctype !== "call" && ctype !== "put") continue;

    if (underlyingPrice == null && r.underlying_asset?.price) {
      underlyingPrice = r.underlying_asset.price;
    }

    const c: PolygonParsedContract = {
      strike: Math.round(r.details.strike_price * 100) / 100,
      expiration: normalizeExpirationYmd(r.details.expiration_date),
      schwabSymbol: r.details.ticker ? polygonTickerToSchwabSymbol(r.details.ticker) : undefined,
      bid: r.last_quote?.bid,
      ask: r.last_quote?.ask,
      bidSize: r.last_quote?.bid_size,
      askSize: r.last_quote?.ask_size,
      last: r.last_trade?.price,
      volume: r.day?.volume,
      openInterest: r.open_interest,
      iv: r.implied_volatility,
      delta: r.greeks?.delta,
      gamma: r.greeks?.gamma,
      theta: r.greeks?.theta,
      vega: r.greeks?.vega,
      dte: computeDte(r.details.expiration_date),
    };

    if (ctype === "call") calls.push(c);
    else puts.push(c);
  }

  return { calls, puts, underlyingPrice };
}

export async function fetchPolygonChain(
  symbol: string,
  apiKey: string,
  opts: {
    maxDte?: number;
    strikeMin?: number;
    strikeMax?: number;
    maxPages?: number;
    log?: { info: (...a: any[]) => void; warn: (...a: any[]) => void };
  } = {}
): Promise<PolygonChainResult | null> {
  const { maxDte = 60, strikeMin, strikeMax, maxPages = 12, log } = opts;

  /** NY calendar dates — avoids UTC `expiration_date_gte` running "ahead" of US and filtering out all near-term listings. */
  const nyToday = nyCalendarYmd(new Date());
  const minDate = nyToday;
  const maxDate = addCalendarDaysNy(nyToday, maxDte);

  const params = new URLSearchParams({
    expiration_date_gte: minDate,
    expiration_date_lte: maxDate,
    limit: "250",
    apiKey,
  });
  if (strikeMin != null) params.set("strike_price_gte", String(strikeMin));
  if (strikeMax != null) params.set("strike_price_lte", String(strikeMax));

  let nextUrl: string | undefined =
    `https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(symbol)}?${params.toString()}`;

  const allResults: PolygonOptionResult[] = [];
  let pages = 0;

  while (nextUrl && pages < maxPages) {
    const fetchUrl = pages > 0 ? `${nextUrl}&apiKey=${apiKey}` : nextUrl;
    const pathForTrace = (() => {
      try {
        const u = new URL(fetchUrl.replace(/\bapiKey=[^&]+/i, "apiKey=[REDACTED]"));
        return u.pathname + u.search;
      } catch {
        return fetchUrl.split("?")[0] ?? fetchUrl;
      }
    })();
    const t0 = Date.now();
    let timedOut = false;
    // [LIVE_FL_DIAG] Watcher / chain path uses this URL (options snapshot) for live flow subs.
    const logUrl = fetchUrl.replace(/apiKey=[^&]+/i, "apiKey=[REDACTED]");
    try {
      const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15_000) });
      appendPolygonApiTraceRecord({
        path: pathForTrace,
        method: "GET",
        statusCode: resp.status,
        responseTimeMs: Date.now() - t0,
        paginationPages: pages + 1,
        saw429: resp.status === 429,
        timedOut,
      });
      const bodyText = await resp.text();
      const bodyPreview = bodyText.length > 500 ? bodyText.slice(0, 500) + "…" : bodyText;
      // eslint-disable-next-line no-console
      console.log("[LIVE_FL_DIAG] fetchPolygonChain", { url: logUrl, httpStatus: resp.status, bodyPreview });
      if (!resp.ok) {
        log?.warn({ status: resp.status, symbol, page: pages }, "Polygon chain page failed");
        break;
      }
      const json = JSON.parse(bodyText) as PolygonSnapshotPage;
      if (!json.results?.length) break;
      const st = json.status == null ? "OK" : String(json.status).toUpperCase();
      if (st !== "OK" && st !== "DELAYED") {
        log?.warn({ status: json.status, symbol, page: pages }, "Polygon chain page: unexpected status (still ingesting results)");
      }
      allResults.push(...json.results);
      nextUrl = json.next_url;
      pages++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort|timeout/i.test(msg)) timedOut = true;
      appendPolygonApiTraceRecord({
        path: pathForTrace,
        method: "GET",
        statusCode: null,
        responseTimeMs: Date.now() - t0,
        paginationPages: pages + 1,
        timedOut,
      });
      log?.warn({ err, symbol, page: pages }, "Polygon chain fetch error");
      break;
    }
  }

  if (allResults.length === 0) {
    log?.warn({ symbol }, "Polygon chain: 0 results");
    return null;
  }

  const { calls, puts, underlyingPrice } = parseResults(allResults);
  if (calls.length + puts.length === 0 && allResults.length > 0) {
    log?.warn(
      { symbol, rawCount: allResults.length },
      "Polygon chain: 0 contracts after parse — check details.contract_type / expiration_date shape",
    );
  }
  // eslint-disable-next-line no-console
  console.log("[LIVE_FL_DIAG] fetchPolygonChain parsed", {
    symbol,
    calls: calls.length,
    puts: puts.length,
    pages,
    underlyingPrice: underlyingPrice ?? null,
    rawCount: allResults.length,
  });
  log?.info(
    { symbol, calls: calls.length, puts: puts.length, pages, underlyingPrice, rawCount: allResults.length },
    "Polygon chain fetched"
  );
  return { calls, puts, underlyingPrice, rawContractsFetched: allResults.length };
}
