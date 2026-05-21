import type { optionsFlowPerStrikeTable } from "@workspace/db";
import { normalizeIV } from "./ivNormalize.js";
import { resolveFlowRowSessionDateNy } from "./polygonSnapshotSessionDate.js";

/**
 * Map one Polygon /v3/snapshot/options contract result to a flow-per-strike insert row.
 * Session `date` is explicit override or SIP-derived — never the request clock.
 */
export function parsePolygonSnapshotResultToFlowRow(
  r: Record<string, unknown>,
  symUpper: string,
  explicitSessionDate?: string | null,
): typeof optionsFlowPerStrikeTable.$inferInsert | null {
  const sessionDate = resolveFlowRowSessionDateNy(r, explicitSessionDate);
  if (!sessionDate) return null;

  const details = r["details"] as Record<string, unknown> | undefined;
  const day = r["day"] as Record<string, unknown> | undefined;
  const lastQuote = r["last_quote"] as Record<string, unknown> | undefined;
  const greeks = r["greeks"] as Record<string, unknown> | undefined;
  if (!details) return null;

  const rawCt = String(details["contract_type"] ?? "").toLowerCase();
  const contractType = rawCt === "call" ? "call" : rawCt === "put" ? "put" : null;
  if (!contractType) return null;
  const strikePrice = details["strike_price"] as number;
  const expDate = details["expiration_date"] as string;
  if (expDate == null || strikePrice == null || !Number.isFinite(strikePrice)) return null;

  const vol = (day?.["volume"] ?? 0) as number;
  const oi = (r["open_interest"] ?? 0) as number;
  const bid = (lastQuote?.["bid"] ?? 0) as number;
  const ask = (lastQuote?.["ask"] ?? 0) as number;
  const mid = (bid + ask) / 2;

  const nowMs = Date.now();
  const dte = Math.max(0, Math.round((new Date(`${expDate}T20:00:00Z`).getTime() - nowMs) / 86_400_000));

  return {
    underlyingSymbol: symUpper,
    date: sessionDate,
    optionType: contractType,
    strike: strikePrice,
    expiration: expDate,
    dte,
    dailyVolume: vol,
    openInterest: oi,
    bid,
    ask,
    mid,
    impliedVolatility: normalizeIV((r["implied_volatility"] as number) ?? null),
    delta: (greeks?.["delta"] as number) ?? null,
    gamma: (greeks?.["gamma"] as number) ?? null,
    theta: (greeks?.["theta"] as number) ?? null,
    vega: (greeks?.["vega"] as number) ?? null,
    avgTradePrice: (day?.["vwap"] as number) ?? mid,
  };
}
