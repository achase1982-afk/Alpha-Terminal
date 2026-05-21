/**
 * Derive US equity session calendar dates from Polygon options snapshot payloads.
 * Ingest must not default to request-day when the snapshot reflects prior-session data.
 */
/** US equity session calendar (same zone as getMarketContext session math). */
export const US_EQUITY_SESSION_TIME_ZONE = "America/New_York";

/** Nanosecond SIP timestamp from Polygon → epoch ms. */
export function parsePolygonSipTimestampNsToMs(raw: unknown): number | null {
  if (raw == null) return null;
  try {
    const n = typeof raw === "bigint" ? raw : BigInt(String(raw));
    if (n <= 0n) return null;
    const ms = Number(n / 1_000_000n);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Session date (YYYY-MM-DD, America/New_York) from contract last trade / quote SIP times.
 * Uses the latest SIP instant present on the snapshot object.
 */
export function derivePolygonSnapshotSessionDateNy(
  snapshotResult: Record<string, unknown>,
): string | null {
  const ms: number[] = [];

  const lastTrade = snapshotResult["last_trade"] as Record<string, unknown> | undefined;
  if (lastTrade) {
    const t = parsePolygonSipTimestampNsToMs(lastTrade["sip_timestamp"]);
    if (t != null) ms.push(t);
  }

  const lastQuote = snapshotResult["last_quote"] as Record<string, unknown> | undefined;
  if (lastQuote) {
    const t = parsePolygonSipTimestampNsToMs(lastQuote["sip_timestamp"]);
    if (t != null) ms.push(t);
  }

  const fmv = parsePolygonSipTimestampNsToMs(snapshotResult["fmv_last_updated"]);
  if (fmv != null) ms.push(fmv);

  if (ms.length === 0) return null;

  const maxMs = Math.max(...ms);
  const ymd = new Date(maxMs).toLocaleDateString("en-CA", {
    timeZone: US_EQUITY_SESSION_TIME_ZONE,
  });
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/**
 * Row session date: explicit scheduler override, else payload-derived (never request clock).
 */
export function resolveFlowRowSessionDateNy(
  snapshotResult: Record<string, unknown>,
  explicitSessionDate?: string | null,
): string | null {
  const explicit = explicitSessionDate?.trim();
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  return derivePolygonSnapshotSessionDateNy(snapshotResult);
}
