const EXPIRY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_RE = /^[A-Z.$]{1,10}$/;

const MIN_SINCE_MS = Date.UTC(2000, 0, 1);
const MAX_SINCE_MS = Date.UTC(2100, 0, 1);

export function deskValidateMarketDate(raw: string | undefined, fallback: string): string | null {
  const v = (raw?.trim() || fallback).slice(0, 10);
  return EXPIRY_RE.test(v) ? v : null;
}

export function deskValidateUwTicker(raw: string | undefined, fallback = "SPX"): string | null {
  const v = (raw?.trim().toUpperCase() || fallback).slice(0, 10);
  return TICKER_RE.test(v) ? v : null;
}

export type DeskSinceParse =
  | { ok: true; ms: number | null }
  | { ok: false; error: string };

/** Accept epoch ms or ISO; reject garbage and implausible ranges. */
export function deskParseSinceMs(raw: string | undefined): DeskSinceParse {
  if (raw == null || String(raw).trim() === "") {
    return { ok: true, ms: null };
  }
  const s = String(raw).trim();
  let ms: number;
  const n = Number(s);
  if (Number.isFinite(n) && /^\d+(\.\d+)?$/.test(s)) {
    if (n > 1e12) ms = Math.floor(n);
    else if (n > 1e9) ms = Math.floor(n * 1000);
    else return { ok: false, error: "since_epoch_out_of_range" };
  } else {
    ms = Date.parse(s);
    if (!Number.isFinite(ms)) return { ok: false, error: "since_invalid" };
  }
  if (ms < MIN_SINCE_MS || ms > MAX_SINCE_MS) {
    return { ok: false, error: "since_out_of_range" };
  }
  return { ok: true, ms };
}
