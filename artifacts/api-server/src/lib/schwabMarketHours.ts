import { getBestAccessToken } from "./tokenStore.js";
import { nyCalendarYmd, isNyseFullDayClosureYmd } from "./usEquityMarketCalendar.js";
import { logger } from "./logger.js";

const SCHWAB_MARKETDATA = "https://api.schwabapi.com/marketdata/v1";
const CACHE_TTL_MS = 60_000;

export type EquityMarketSession = "open" | "closed" | "premarket" | "afterhours" | "unknown";

export type EquitySessionResolutionSource = "schwab" | "calendar_fallback";

type Cached = {
  session: EquityMarketSession;
  asOf: string;
  until: number;
  source: EquitySessionResolutionSource;
};

let cache: Cached | null = null;

function equitySessionDateYmd(): string {
  return nyCalendarYmd(new Date());
}

function parseIsoMs(s: unknown): number | null {
  if (typeof s !== "string" || s.length < 8) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * Schwab returns each session type as either `{ start, end }` or `[{ start, end }, ...]`.
 * Arrays are objects in JS; without unwrapping, `o["start"]` is always undefined.
 */
function readSessionWindow(
  hours: Record<string, unknown> | undefined,
  key: string,
): { start: number; end: number } | null {
  const w = hours?.[key];
  if (w == null || typeof w !== "object") return null;
  const candidates: unknown[] = Array.isArray(w) ? w : [w];
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const start = parseIsoMs(o["start"]);
    const end = parseIsoMs(o["end"]);
    if (start != null && end != null && end > start) return { start, end };
  }
  return null;
}

/**
 * Classify current instant against session windows (half-open [start, end)).
 * Regular session checked first so it wins if Schwab windows overlap oddly.
 */
function classifySession(
  nowMs: number,
  pre: { start: number; end: number } | null,
  reg: { start: number; end: number } | null,
  post: { start: number; end: number } | null,
): EquityMarketSession {
  if (reg && nowMs >= reg.start && nowMs < reg.end) return "open";
  if (pre && nowMs >= pre.start && nowMs < pre.end) return "premarket";
  if (post && nowMs >= post.start && nowMs < post.end) return "afterhours";
  return "closed";
}

function extractEquityDay(json: Record<string, unknown>): {
  pre: { start: number; end: number } | null;
  reg: { start: number; end: number } | null;
  post: { start: number; end: number } | null;
} {
  const equity = json["equity"] as Record<string, unknown> | undefined;
  if (!equity || typeof equity !== "object") {
    return { pre: null, reg: null, post: null };
  }

  let day: Record<string, unknown> | null = null;
  for (const v of Object.values(equity)) {
    if (!v || typeof v !== "object") continue;
    const row = v as Record<string, unknown>;
    if ("sessionHours" in row || "isOpen" in row) {
      day = row;
      break;
    }
  }
  if (!day) {
    const first = Object.values(equity).find((x) => x && typeof x === "object") as Record<string, unknown> | undefined;
    if (first) day = first;
  }

  const sessionHours =
    (day?.["sessionHours"] as Record<string, unknown> | undefined)
    ?? (day?.["sessionhours"] as Record<string, unknown> | undefined);

  return {
    pre: readSessionWindow(sessionHours, "preMarket"),
    reg: readSessionWindow(sessionHours, "regularMarket"),
    post: readSessionWindow(sessionHours, "postMarket"),
  };
}

async function fetchEquitySessionFromSchwab(dateYmd: string): Promise<EquityMarketSession> {
  const token = getBestAccessToken();
  /** Do not default to **closed** on failure — that would suppress real contamination flags. */
  if (!token) return "unknown";

  const url = `${SCHWAB_MARKETDATA}/markets?markets=equity&date=${encodeURIComponent(dateYmd)}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return "unknown";
    const json = (await res.json()) as Record<string, unknown>;
    const { pre, reg, post } = extractEquityDay(json);
    if (pre == null && reg == null && post == null) return "unknown";
    return classifySession(Date.now(), pre, reg, post);
  } catch {
    return "unknown";
  }
}

/** NYSE-style session bucket from wall clock in America/New_York (fallback when Schwab is unavailable). */
export function equitySessionFromNyCalendarFallback(nowMs: number): EquityMarketSession {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(nowMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const weekday = get("weekday") ?? "";
  const year = get("year") ?? "";
  const month = get("month") ?? "";
  const day = get("day") ?? "";
  const hour = parseInt(get("hour") ?? "0", 10);
  const minute = parseInt(get("minute") ?? "0", 10);
  const minutes = hour * 60 + minute;
  const ymd = `${year}-${month}-${day}`;
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (isNyseFullDayClosureYmd(ymd)) return "closed";

  if (minutes >= 20 * 60 || minutes < 4 * 60) return "closed";
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "premarket";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "open";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "afterhours";
  return "closed";
}

/**
 * Schwab equity session for the current instant (UTC compared to NY session windows
 * returned for today's calendar date in the request). Cached 60s in-process.
 */
export async function getEquityMarketSession(): Promise<EquityMarketSession> {
  const { session } = await getEquityMarketSessionWithAsOf();
  return session;
}

/** Same cache as {@link getEquityMarketSession}; includes resolution timestamp for payloads. */
export async function getEquityMarketSessionWithAsOf(): Promise<{
  session: EquityMarketSession;
  asOf: string;
  sessionSource: EquitySessionResolutionSource;
}> {
  const now = Date.now();
  if (cache && now < cache.until) {
    return { session: cache.session, asOf: cache.asOf, sessionSource: cache.source };
  }

  const asOf = new Date(now).toISOString();
  const dateYmd = equitySessionDateYmd();
  const schwabSession = await fetchEquitySessionFromSchwab(dateYmd);
  let session: EquityMarketSession;
  let source: EquitySessionResolutionSource;
  if (schwabSession !== "unknown") {
    session = schwabSession;
    source = "schwab";
  } else {
    session = equitySessionFromNyCalendarFallback(now);
    source = "calendar_fallback";
    logger.info(
      { session, asOf, dateYmd },
      "schwabMarketHours: using NY calendar fallback for equity session (Schwab unavailable or unparsable)",
    );
  }
  cache = { session, asOf, until: now + CACHE_TTL_MS, source };
  return { session, asOf, sessionSource: source };
}

/** @internal vitest — full markets JSON → parsed windows (array-wrapped periods). */
export function __extractEquityDayForTests(json: Record<string, unknown>): {
  pre: { start: number; end: number } | null;
  reg: { start: number; end: number } | null;
  post: { start: number; end: number } | null;
} {
  return extractEquityDay(json);
}

/** @internal vitest */
export function __classifyEquitySessionForTests(
  nowMs: number,
  pre: { start: number; end: number } | null,
  reg: { start: number; end: number } | null,
  post: { start: number; end: number } | null,
): EquityMarketSession {
  return classifySession(nowMs, pre, reg, post);
}

/** @internal tests */
export function __resetEquityMarketSessionCacheForTests(): void {
  cache = null;
}
