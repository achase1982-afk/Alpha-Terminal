import { appendPolygonApiTraceRecord } from "./polygonApiTrace.js";
import { addCalendarDaysNy, nyCalendarYmd } from "./usEquityMarketCalendar.js";

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
