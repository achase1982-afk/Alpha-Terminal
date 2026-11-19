const TZ = "America/New_York";

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: "Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
  date: string;
}

const WEEK: ZonedParts["weekday"][] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(iso: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(iso))) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const short = (bag.weekday ?? "Sun").slice(0, 3) as ZonedParts["weekday"];
  const weekday = WEEK.includes(short) ? short : "Sun";
  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  return {
    year,
    month,
    day,
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function minutesOfDay(parts: ZonedParts): number {
  return parts.hour * 60 + parts.minute;
}

export function ytdStart(nowIso: string): string {
  return `${zonedParts(nowIso).year}-01-01`;
}

/** UTC instant of Jan 1, 00:00 in America/New_York for the year of `iso`. */
export function startOfYearEt(iso: string): string {
  const year = zonedParts(iso).year;
  return atEtHour(`${year}-01-01`, 0, 0);
}

function atEtHour(date: string, hour: number, minute: number): string {
  const wall = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`);
  for (const offsetHours of [5, 4]) {
    const candidate = new Date(wall + offsetHours * 3_600_000).toISOString();
    const parts = zonedParts(candidate);
    if (parts.date === date && parts.hour === hour && parts.minute === minute) return candidate;
  }
  return new Date(wall + 5 * 3_600_000).toISOString();
}

export function formatClock(parts: ZonedParts): string {
  const h24 = parts.hour;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(parts.minute).padStart(2, "0")} ${suffix}`;
}

export function formatMonthDay(parts: ZonedParts): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parts.month - 1]} ${parts.day}`;
}

function noonUtc(value: string): string {
  if (value.includes("T")) return value;
  return `${value.slice(0, 10)}T12:00:00.000Z`;
}

export function formatWindow(start: string, end: string): string {
  const s = zonedParts(noonUtc(start));
  const e = zonedParts(noonUtc(end));
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (s.year === e.year) {
    return `${months[s.month - 1]} ${s.day} – ${months[e.month - 1]} ${e.day}, ${e.year}`;
  }
  return `${months[s.month - 1]} ${s.day}, ${s.year} – ${months[e.month - 1]} ${e.day}, ${e.year}`;
}

export function calendarDays(startDate: string, endDate: string): number {
  const a = Date.parse(`${startDate.slice(0, 10)}T00:00:00.000Z`);
  const b = Date.parse(`${endDate.slice(0, 10)}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}
