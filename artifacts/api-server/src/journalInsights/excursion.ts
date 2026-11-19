import type { ExcursionView } from "./types.js";

export interface QuoteSample {
  ts: string;
  valid: boolean;
  unrealized: number | null;
}

function dollars(value: number): string {
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value > 0) return `+$${abs}`;
  if (value < 0) return `-$${abs}`;
  return `$${abs}`;
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).format(new Date(iso)).replace(/\s/g, " ").toUpperCase();
}

function etParts(iso: string): { date: string; minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(pick("weekday").slice(0, 3));
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    minutes: hour * 60 + Number(pick("minute")),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

function regularMinutes(openedAt: string, closedAt: string): number {
  const start = Date.parse(openedAt);
  const end = Date.parse(closedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let count = 0;
  const cap = start + 40 * 24 * 60 * 60 * 1000;
  for (let at = start; at <= end && at <= cap; at += 60_000) {
    const part = etParts(new Date(at).toISOString());
    if (part.weekday === 0 || part.weekday === 6) continue;
    if (part.minutes >= 9 * 60 + 30 && part.minutes < 16 * 60) count += 1;
  }
  return count;
}

function hasGap(samples: QuoteSample[]): boolean {
  const valid = samples.filter((sample) => sample.valid).sort((a, b) => a.ts.localeCompare(b.ts));
  for (let i = 1; i < valid.length; i += 1) {
    const prev = valid[i - 1]!;
    const next = valid[i]!;
    const left = etParts(prev.ts);
    const right = etParts(next.ts);
    const bothRegular = left.weekday !== 0 && left.weekday !== 6 && right.weekday !== 0 && right.weekday !== 6
      && left.minutes >= 9 * 60 + 30 && left.minutes < 16 * 60
      && right.minutes >= 9 * 60 + 30 && right.minutes < 16 * 60
      && left.date === right.date;
    if (bothRegular && Date.parse(next.ts) - Date.parse(prev.ts) > 3 * 60_000) return true;
  }
  return false;
}

export function excursionFromSamples(input: {
  openedAt: string;
  closedAt: string | null;
  exitPnl: number | null;
  startedLate: boolean;
  samples: QuoteSample[];
}): ExcursionView {
  const samples = input.samples.filter((sample) => sample.valid && sample.unrealized != null);
  if (samples.length === 0 && input.exitPnl == null) {
    return { record: "none", mfe: null, mae: null, timeToMfeMin: null, peakCapturePct: null, bestAt: null, label: "Not recorded" };
  }
  const points = [
    { ts: input.openedAt, unrealized: 0 },
    ...samples.map((sample) => ({ ts: sample.ts, unrealized: sample.unrealized ?? 0 })),
  ];
  if (input.closedAt && input.exitPnl != null) points.push({ ts: input.closedAt, unrealized: input.exitPnl });
  let mfe = points[0]?.unrealized ?? 0;
  let mae = mfe;
  let bestAt = points[0]?.ts ?? input.openedAt;
  for (const point of points) {
    if (point.unrealized > mfe) {
      mfe = point.unrealized;
      bestAt = point.ts;
    }
    if (point.unrealized < mae) mae = point.unrealized;
  }
  const end = input.closedAt ?? points[points.length - 1]?.ts ?? input.openedAt;
  const expected = regularMinutes(input.openedAt, end);
  const coverage = expected === 0 ? 1 : samples.length / expected;
  const partial = input.startedLate || coverage < 0.9 || hasGap(input.samples);
  const record = partial || !input.closedAt ? "partial" : "full";
  const peakCapturePct = record === "full" && input.exitPnl != null && mfe > 0 ? input.exitPnl / mfe : null;
  const captured = peakCapturePct == null ? "" : ` · captured ${Math.round(peakCapturePct * 100)}% at mid`;
  let label = record === "partial"
    ? "Partial record"
    : `Best ${dollars(mfe)} at ${clock(bestAt)}${captured}`;
  if (record === "full" && input.exitPnl != null && mfe > 0 && input.exitPnl <= 0) label = `${label}. Peaked green, closed red/flat`;
  if (record === "full" && input.exitPnl != null && input.exitPnl > 0 && mae < 0 && Math.abs(mae) > input.exitPnl) {
    label = `${label}. Drawdown larger than final gain`;
  }
  return {
    record,
    mfe,
    mae,
    timeToMfeMin: Math.max(0, Math.round((Date.parse(bestAt) - Date.parse(input.openedAt)) / 60_000)),
    peakCapturePct,
    bestAt,
    label,
  };
}

export function medianRecordedLine(rows: ExcursionView[]): string | null {
  const full = rows.filter((row) => row.record === "full" && row.peakCapturePct != null);
  if (full.length === 0) return null;
  const mid = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] ?? 0;
  const capture = Math.round(mid(full.map((row) => (row.peakCapturePct ?? 0) * 100)));
  const minutes = mid(full.map((row) => row.timeToMfeMin ?? 0));
  return `Median captured ${capture}% of peak · median time to peak ${minutes}m (n=${full.length} recorded)`;
}
