import { useState, useEffect } from "react";

type Session = "PRE" | "RTH" | "AH" | "CLOSED";

interface SessionInfo {
  session: Session;
  label: string;
  timeStr: string;
  countdown: string;
  color: string;
}

function getEasternTime(): Date {
  const now = new Date();
  const eastern = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  return eastern;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(s)}s`;
}

function getSessionInfo(): SessionInfo {
  const et = getEasternTime();
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;
  const day = et.getDay();
  const isWeekend = day === 0 || day === 6;

  const timeStr = `${h > 12 ? h - 12 : h || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"} ET`;

  if (isWeekend) {
    const daysUntilMon = day === 0 ? 1 : 2;
    const nextOpen = new Date(et);
    nextOpen.setDate(nextOpen.getDate() + daysUntilMon);
    nextOpen.setHours(4, 0, 0, 0);
    const msLeft = nextOpen.getTime() - et.getTime();
    return {
      session: "CLOSED",
      label: "WEEKEND",
      timeStr,
      countdown: fmtCountdown(msLeft),
      color: "#71717a",
    };
  }

  const PRE_OPEN = 4 * 60;
  const RTH_OPEN = 9 * 60 + 30;
  const RTH_CLOSE = 16 * 60;
  const AH_CLOSE = 20 * 60;

  if (mins >= RTH_OPEN && mins < RTH_CLOSE) {
    const msLeft = ((RTH_CLOSE - mins) * 60 - et.getSeconds()) * 1000;
    return {
      session: "RTH",
      label: "MARKET OPEN",
      timeStr,
      countdown: fmtCountdown(msLeft),
      color: "#00d166",
    };
  }

  if (mins >= PRE_OPEN && mins < RTH_OPEN) {
    const msLeft = ((RTH_OPEN - mins) * 60 - et.getSeconds()) * 1000;
    return {
      session: "PRE",
      label: "PRE-MARKET",
      timeStr,
      countdown: fmtCountdown(msLeft),
      color: "#FFB800",
    };
  }

  if (mins >= RTH_CLOSE && mins < AH_CLOSE) {
    const msLeft = ((AH_CLOSE - mins) * 60 - et.getSeconds()) * 1000;
    return {
      session: "AH",
      label: "AFTER HOURS",
      timeStr,
      countdown: fmtCountdown(msLeft),
      color: "#a78bfa",
    };
  }

  let msLeft: number;
  if (mins >= AH_CLOSE) {
    const nextPre = new Date(et);
    nextPre.setDate(nextPre.getDate() + (day === 5 ? 3 : 1));
    nextPre.setHours(4, 0, 0, 0);
    msLeft = nextPre.getTime() - et.getTime();
  } else {
    msLeft = ((PRE_OPEN - mins) * 60 - et.getSeconds()) * 1000;
  }

  return {
    session: "CLOSED",
    label: "CLOSED",
    timeStr,
    countdown: fmtCountdown(msLeft),
    color: "#71717a",
  };
}

export function MarketSessionClock() {
  const [info, setInfo] = useState<SessionInfo>(getSessionInfo);

  useEffect(() => {
    const id = setInterval(() => setInfo(getSessionInfo()), 1000);
    return () => clearInterval(id);
  }, []);

  const countdownLabel =
    info.session === "RTH"
      ? "closes"
      : info.session === "AH"
        ? "ends"
        : info.session === "PRE"
          ? "opens"
          : "opens";

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className="font-mono text-[10px] font-bold uppercase tracking-widest"
        style={{ color: info.color }}
      >
        {info.label}
      </span>
      <span
        className="font-mono text-[11px] font-bold tabular-nums whitespace-nowrap text-white"
      >
        {info.countdown}
      </span>
    </div>
  );
}
