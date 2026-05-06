import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import pLimit from "p-limit";
import { getStoredIVR, normalizeIV } from "./ivNormalize.js";

/** Layer 3 vol metrics for scanner cards (decimals for IV/HV; IVR 0–100). */
export type ScannerVolContext = {
  iv30: number | null;
  ivr: number | null;
  hv30: number | null;
  ivVsHv: number | null;
};

const IVR_FETCH_CONCURRENCY = 14;

/**
 * `equity_daily.hv_*` is populated both as annualized decimals (~0.35) and as
 * percentage-style magnitudes (~35) depending on writer; normalize to IV-style decimal for `ScannerCardData`.
 *
 * When `iv30dProxy` is present it matches `hv_30d` from `hvProxyBackfill` (same row): `iv_30d_proxy ≈ hv * vrp`
 * with vrp in ~[1.08, 1.30], so `hv / iv_30d_proxy` stays near `1/vrp`. Snapshot percentage HV (~35) vs the
 * same proxy IV (~0.4) yields a huge ratio, so we still divide by 100.
 */
export function hv30DbToDecimal(
  raw: number | null | undefined,
  iv30dProxy?: number | null,
): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  if (raw <= 0) return null;
  if (raw > 1.25) {
    const p = iv30dProxy;
    if (p != null && p > 0 && Number.isFinite(p)) {
      const ratio = raw / p;
      // Band covers 1/vrp for vrp in [1.08, 1.30] (see `vrpMultiplierFor` in hvProxyBackfill).
      if (ratio >= 1 / 1.31 && ratio <= 1 / 1.075) return raw;
    }
    return raw / 100;
  }
  return raw;
}

function ivVsHv(iv30: number | null, hv30: number | null): number | null {
  if (iv30 == null || hv30 == null || !Number.isFinite(iv30) || !Number.isFinite(hv30) || hv30 === 0) {
    return null;
  }
  return Math.round((iv30 / hv30) * 100) / 100;
}

type LatestEqRow = {
  symbol: string;
  date: string;
  iv30d: number | null;
  iv30dProxy: number | null;
  hv30d: number | null;
};

async function fetchLatestEquityDailyRows(symbols: string[]): Promise<Map<string, LatestEqRow>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, LatestEqRow>();
  if (uniq.length === 0) return out;

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (symbol)
      symbol,
      date::text AS date,
      iv_30d,
      iv_30d_proxy,
      hv_30d
    FROM equity_daily
    WHERE symbol IN (${sql.join(uniq.map((s) => sql`${s}`), sql`, `)})
    ORDER BY symbol ASC, date DESC
  `);

  const list = (rows.rows ?? []) as Record<string, unknown>[];
  for (const r of list) {
    const sym = r.symbol != null ? String(r.symbol).toUpperCase().trim() : "";
    if (!sym) continue;
    out.set(sym, {
      symbol: sym,
      date: String(r.date ?? ""),
      iv30d: r.iv_30d != null ? Number(r.iv_30d) : null,
      iv30dProxy: r.iv_30d_proxy != null ? Number(r.iv_30d_proxy) : null,
      hv30d: r.hv_30d != null ? Number(r.hv_30d) : null,
    });
  }
  return out;
}

/**
 * Vol context for scanner Layer 3.
 *
 * - **IV30**: `equity_daily.iv_30d` (daily snapshot / chain ATM IV30), else `iv_30d_proxy`, else Schwab quote implied vol when provided.
 * - **HV30**: latest `equity_daily.hv_30d` (daily snapshot close-return HV30), normalized to decimal.
 * - **IVR**: {@link getStoredIVR} when equity history supports rank (requires persisted IV series); otherwise null.
 * - **IV vs HV**: IV30 / HV30 when both present.
 */
export async function fetchScannerVolContextForSymbols(
  symbols: string[],
  schwabIvDecimalBySymbol?: ReadonlyMap<string, number | null>,
): Promise<Map<string, ScannerVolContext>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const latestBySym = await fetchLatestEquityDailyRows(uniq);

  const limit = pLimit(IVR_FETCH_CONCURRENCY);
  const ivrBySym = new Map<string, number | null>();
  await Promise.all(
    uniq.map((sym) =>
      limit(async () => {
        const stored = await getStoredIVR(sym);
        ivrBySym.set(sym, stored?.ivr ?? null);
      }),
    ),
  );

  const out = new Map<string, ScannerVolContext>();
  for (const sym of uniq) {
    const row = latestBySym.get(sym);
    const ivFromEq =
      normalizeIV(row?.iv30d ?? null) ??
      normalizeIV(row?.iv30dProxy ?? null);
    const ivFromSchwab = normalizeIV(schwabIvDecimalBySymbol?.get(sym) ?? null);
    const iv30 = ivFromEq ?? ivFromSchwab ?? null;

    const hv30 = hv30DbToDecimal(row?.hv30d ?? null, row?.iv30dProxy ?? null);

    const ivVs = ivVsHv(iv30, hv30);

    out.set(sym, {
      iv30,
      ivr: ivrBySym.get(sym) ?? null,
      hv30,
      ivVsHv: ivVs,
    });
  }

  return out;
}
