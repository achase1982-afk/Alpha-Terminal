/** Error helpers for strategist_telemetry reads/writes (no runtime DDL). */

export function sanitizeStrategistTelemetryClientDetail(flat: string): string {
  const s = flat.trim();
  if (s.length === 0) return "";
  if (/\bDO\s*\$\$/i.test(s) || (/\bALTER\s+TABLE\b/i.test(s) && s.length > 240)) {
    return "Database schema alignment failed (full message in API server logs only).";
  }
  return s.slice(0, 500);
}

export function strategistTelemetryFlattenErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  const seen = new Set<unknown>();
  for (let i = 0; i < 10 && cur != null && !seen.has(cur); i++) {
    seen.add(cur);
    if (cur instanceof Error) parts.push(cur.message);
    else if (typeof cur === "string") parts.push(cur);
    else if (typeof cur === "object" && cur !== null && "message" in cur) {
      const m = (cur as { message: unknown }).message;
      if (typeof m === "string") parts.push(m);
    }
    cur =
      cur !== null && typeof cur === "object" && "cause" in cur
        ? (cur as { cause: unknown }).cause
        : undefined;
  }
  return parts.join(" · ");
}

export function strategistTelemetryPostgresErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  for (let i = 0; i < 10 && cur != null && !seen.has(cur); i++) {
    seen.add(cur);
    if (typeof cur === "object" && cur !== null && "code" in cur) {
      const c = (cur as { code: unknown }).code;
      if (typeof c === "string" && c.length > 0) return c;
    }
    cur =
      cur !== null && typeof cur === "object" && "cause" in cur
        ? (cur as { cause: unknown }).cause
        : undefined;
  }
  return undefined;
}
