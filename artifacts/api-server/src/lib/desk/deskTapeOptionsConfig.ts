import { deskEnv } from "./deskEnv.js";
import { deskSessionDateEt } from "./deskEt.js";

const US_EQUITY_TZ = "America/New_York";

export function deskTapeOptionsMax(): number {
  const raw = deskEnv("DESK_TAPE_OPTIONS_MAX");
  const n = raw ? parseInt(raw, 10) : 15_000;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 25_000) : 15_000;
}

/** Calendar days (ET) as YYYY-MM-DD, starting at today's session date. */
export function deskCalendarDaysFromSession(count: number, anchor = new Date()): string[] {
  const startYmd = deskSessionDateEt(anchor);
  const [y, m, d] = startYmd.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const utc = new Date(Date.UTC(y, m - 1, d + i, 12, 0, 0));
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: US_EQUITY_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(utc);
    out.push(ymd);
  }
  return out;
}

export function deskTapeOptionsExpiries(): string[] {
  const raw = deskEnv("DESK_TAPE_OPTIONS_EXPIRIES").trim();
  if (!raw || raw.toLowerCase() === "7d" || raw.toLowerCase() === "default") {
    return deskCalendarDaysFromSession(7);
  }
  if (raw.includes(",")) {
    return raw
      .split(",")
      .map((s) => s.trim().slice(0, 10))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10))) {
    return [raw.slice(0, 10)];
  }
  return deskCalendarDaysFromSession(7);
}

export async function deskLoadExplicitOptionSymbols(): Promise<string[]> {
  const inline = deskEnv("DESK_TAPE_OPTIONS_SYMBOLS");
  if (inline) {
    try {
      if (inline.startsWith("[")) {
        const parsed = JSON.parse(inline) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((s) => String(s).trim()).filter(Boolean);
        }
      }
    } catch {
      /* comma list */
    }
    return inline
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const url = deskEnv("DESK_TAPE_OPTIONS_SYMBOLS_URL");
  if (!url) return [];

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`symbols_url_http_${res.status}`);
  const json = (await res.json()) as unknown;
  if (Array.isArray(json)) return json.map((s) => String(s).trim()).filter(Boolean);
  if (json && typeof json === "object" && Array.isArray((json as { symbols?: unknown }).symbols)) {
    return (json as { symbols: unknown[] }).symbols.map((s) => String(s).trim()).filter(Boolean);
  }
  return [];
}