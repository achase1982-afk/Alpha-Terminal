const ET = "America/New_York";

export interface MarketClock {
  open: boolean;
  statusLabel: "MARKET OPEN" | "MARKET CLOSED";
  countdownLabel: "Closes" | "Opens";
  countdown: string;
  clock: string;
}

interface EtParts {
  hour: number;
  minute: number;
  second: number;
  /** 0 Sunday … 6 Saturday. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function etParts(now: Date): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = new Map(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  let hour = Number(map.get("hour"));
  if (hour === 24) hour = 0;
  return {
    hour,
    minute: Number(map.get("minute")),
    second: Number(map.get("second")),
    weekday: WEEKDAYS[map.get("weekday") ?? "Sun"] ?? 0,
  };
}

export function formatEtClock(now: Date): string {
  const parts = etParts(now);
  return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ET`;
}

/** Cash session 09:30–16:00 America/New_York, Monday–Friday. */
export function marketClock(now: Date): MarketClock {
  const parts = etParts(now);
  const clock = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)} ET`;
  const sec = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const openSec = 9 * 3600 + 30 * 60;
  const closeSec = 16 * 3600;
  const weekday = parts.weekday;
  const isWeekday = weekday >= 1 && weekday <= 5;
  const open = isWeekday && sec >= openSec && sec < closeSec;
  if (open) {
    return {
      open: true,
      statusLabel: "MARKET OPEN",
      countdownLabel: "Closes",
      countdown: formatHMS(closeSec - sec),
      clock,
    };
  }

  let addDays = 0;
  if (!isWeekday) addDays = weekday === 6 ? 2 : 1;
  else if (sec >= closeSec) addDays = weekday === 5 ? 3 : 1;

  return {
    open: false,
    statusLabel: "MARKET CLOSED",
    countdownLabel: "Opens",
    countdown: formatHMS(addDays * 86400 + openSec - sec),
    clock,
  };
}
