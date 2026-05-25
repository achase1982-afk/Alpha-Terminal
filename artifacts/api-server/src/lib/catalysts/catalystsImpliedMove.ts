import pLimit from "p-limit";
import { getOrFetchChain } from "../../routes/market.js";
import { getBestAccessToken } from "../tokenStore.js";
import { logger } from "../logger.js";

const impliedLimit = pLimit(4);

type ChainLeg = {
  strike: number;
  expiration: string;
  bid?: number;
  ask?: number;
  last?: number;
};

function contractMid(leg: ChainLeg): number | null {
  const bid = leg.bid;
  const ask = leg.ask;
  if (bid != null && ask != null && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  if (leg.last != null && leg.last > 0 && Number.isFinite(leg.last)) {
    return leg.last;
  }
  return null;
}

/** First expiration date (YYYY-MM-DD) on or after the earnings date. */
export function pickExpiryCoveringEarnings(
  expirations: string[],
  earningsDateYmd: string,
): string | null {
  const unique = [
    ...new Set(
      expirations
        .map((e) => (e.length >= 10 ? e.slice(0, 10) : e))
        .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)),
    ),
  ].sort();
  for (const exp of unique) {
    if (exp >= earningsDateYmd) return exp;
  }
  return null;
}

/** ATM straddle mid ÷ spot → implied move percent (one decimal). */
export function impliedMovePctFromStraddle(
  spot: number,
  calls: ChainLeg[],
  puts: ChainLeg[],
  expirationYmd: string,
): number | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;

  const matchExp = (e: string) => e.slice(0, 10) === expirationYmd;
  const nearCalls = calls.filter((c) => matchExp(c.expiration));
  const nearPuts = puts.filter((p) => matchExp(p.expiration));
  if (nearCalls.length === 0 || nearPuts.length === 0) return null;

  const atmCall = [...nearCalls].sort(
    (a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot),
  )[0];
  const atmPut = [...nearPuts].sort(
    (a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot),
  )[0];
  if (!atmCall || !atmPut) return null;

  const callMid = contractMid(atmCall);
  const putMid = contractMid(atmPut);
  if (callMid == null || putMid == null) return null;

  const straddle = callMid + putMid;
  if (!Number.isFinite(straddle) || straddle <= 0) return null;

  const pct = (straddle / spot) * 100;
  return Math.round(pct * 10) / 10;
}

export async function fetchImpliedMovePct(
  symbol: string,
  earningsDateYmd: string,
  spot: number | null,
): Promise<number | null> {
  const token = getBestAccessToken();
  if (!token) return null;

  return impliedLimit(async () => {
    try {
      const chain = await getOrFetchChain(symbol, token, logger);
      if (!chain) return null;

      const price =
        chain.underlyingPrice != null && Number.isFinite(chain.underlyingPrice)
          ? chain.underlyingPrice
          : spot;
      if (price == null || !Number.isFinite(price) || price <= 0) return null;

      const expirations = [
        ...chain.calls.map((c) => c.expiration),
        ...chain.puts.map((p) => p.expiration),
      ];
      const expiry = pickExpiryCoveringEarnings(expirations, earningsDateYmd);
      if (!expiry) return null;

      return impliedMovePctFromStraddle(price, chain.calls, chain.puts, expiry);
    } catch (err) {
      logger.warn({ err, symbol }, "Catalysts implied move fetch failed");
      return null;
    }
  });
}
