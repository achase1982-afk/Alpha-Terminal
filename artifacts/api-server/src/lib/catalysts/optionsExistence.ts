import { and, gte, inArray } from "drizzle-orm";
import pLimit from "p-limit";
import { db, optionsChainDailyTable } from "@workspace/db";
import { getBestAccessToken } from "../tokenStore.js";
import { nyCalendarYmd } from "../usEquityMarketCalendar.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const probeLimit = pLimit(6);

async function schwabHasOptionsChain(symbol: string, token: string): Promise<boolean> {
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    contractType: "CALL",
    strikeCount: "1",
    range: "NTM",
  });
  const url = `${SCHWAB_API_BASE}/chains?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as Record<string, unknown>;
    const callMap = json["callExpDateMap"];
    return callMap != null && typeof callMap === "object" && Object.keys(callMap).length > 0;
  } catch {
    return false;
  }
}

/** Symbols with at least one future-dated chain row in DB. */
export async function symbolsWithOptionsFromDb(symbols: string[]): Promise<Set<string>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  if (unique.length === 0) return new Set();

  const today = nyCalendarYmd(new Date());
  const rows = await db
    .select({ sym: optionsChainDailyTable.underlyingSymbol })
    .from(optionsChainDailyTable)
    .where(
      and(
        inArray(optionsChainDailyTable.underlyingSymbol, unique),
        gte(optionsChainDailyTable.expiration, today),
      ),
    )
    .groupBy(optionsChainDailyTable.underlyingSymbol);

  return new Set(rows.map((r) => r.sym.toUpperCase()));
}

/**
 * Returns the subset of `symbols` that have a listed options chain (DB first, Schwab probe fallback).
 */
export async function resolveSymbolsWithOptions(symbols: string[]): Promise<Set<string>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))];
  const found = await symbolsWithOptionsFromDb(unique);
  const missing = unique.filter((s) => !found.has(s));
  if (missing.length === 0) return found;

  const token = getBestAccessToken();
  if (!token) return found;

  await Promise.all(
    missing.map((sym) =>
      probeLimit(async () => {
        if (await schwabHasOptionsChain(sym, token)) found.add(sym);
      }),
    ),
  );

  return found;
}
