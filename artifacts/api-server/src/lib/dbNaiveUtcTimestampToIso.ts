/**
 * Normalize PostgreSQL `timestamp without time zone` values that store **UTC wall time**
 * into ISO-8601 strings with a `Z` suffix for JSON APIs.
 *
 * node-pg often returns these as strings without a timezone; ECMAScript parses such strings
 * as *local* time. Appending ` UTC` forces UTC interpretation before emitting canonical ISO Z.
 */
export function dbNaiveUtcTimestampToIso(raw: unknown): string | null {
  if (raw instanceof Date) return raw.toISOString();
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const ms = new Date(s).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const ms = new Date(`${s} UTC`).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
