const BLOCKED_SERVICES = new Set([
  "ACCT_ACTIVITY",
  "NASDAQ_BOOK",
  "NYSE_BOOK",
  "LEVELONE_FUTURES",
  "LEVELONE_FUTURES_OPTIONS",
  "TIMESALE_EQUITY",
  "CHART_EQUITY",
]);

const DESK_EQUITY_KEYS = new Set(["$SPX", "SPY", "$VIX"]);

export function isDeskAllowedOptionKey(key: string): boolean {
  const u = key.trim().toUpperCase();
  if (!u) return false;
  if (u.startsWith("SPY")) return false;
  if (u.startsWith("SPXW")) return true;
  if (u.startsWith("SPX")) return true;
  return false;
}

function filterContentRow(service: string, row: Record<string, unknown>): boolean {
  const key = String(row["key"] ?? "").trim();
  if (!key) return false;
  switch (service) {
    case "LEVELONE_EQUITIES":
      return DESK_EQUITY_KEYS.has(key);
    case "LEVELONE_OPTIONS":
    case "OPTIONS_BOOK":
      return isDeskAllowedOptionKey(key);
    default:
      return false;
  }
}

type StreamerDataItem = {
  service?: string;
  content?: Record<string, unknown>[];
  [key: string]: unknown;
};

/**
 * Filter Schwab streamer inbound `data[]` for desk tape/SSE/DB capture.
 * Returns null when nothing should be stored or served.
 */
export function filterDeskTapeStreamerMessage(
  msg: Record<string, unknown>,
): Record<string, unknown> | null {
  const data = msg["data"];
  if (!Array.isArray(data) || data.length === 0) return null;

  const filtered: StreamerDataItem[] = [];
  for (const rawItem of data) {
    if (rawItem == null || typeof rawItem !== "object") continue;
    const item = rawItem as StreamerDataItem;
    const service = String(item.service ?? "");
    if (!service || BLOCKED_SERVICES.has(service)) continue;
    if (service !== "LEVELONE_EQUITIES" && service !== "LEVELONE_OPTIONS" && service !== "OPTIONS_BOOK") {
      continue;
    }
    const content = item.content;
    if (!Array.isArray(content)) continue;
    const kept = content.filter(
      (row): row is Record<string, unknown> =>
        row != null && typeof row === "object" && filterContentRow(service, row as Record<string, unknown>),
    );
    if (kept.length === 0) continue;
    filtered.push({ ...item, content: kept });
  }

  if (filtered.length === 0) return null;
  return { ...msg, data: filtered };
}

export function filterDeskTapeRawJsonLine(line: string): string | null {
  try {
    const obj = JSON.parse(line) as { m?: unknown };
    const m = obj.m;
    if (m == null || typeof m !== "object") return null;
    const filtered = filterDeskTapeStreamerMessage(m as Record<string, unknown>);
    if (!filtered) return null;
    return JSON.stringify({ ...obj, m: filtered });
  } catch {
    return null;
  }
}

export function messageContainsAcctActivity(msg: Record<string, unknown>): boolean {
  const data = msg["data"];
  if (!Array.isArray(data)) return false;
  return data.some((item) => item != null && typeof item === "object" && (item as StreamerDataItem).service === "ACCT_ACTIVITY");
}