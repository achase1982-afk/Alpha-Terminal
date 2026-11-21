import { useState, useEffect } from "react";
import { NYSE_EARLY_CLOSE, NYSE_HOLIDAYS } from "@workspace/order-ticket-math";

type Session = "PRE" | "RTH" | "AH" | "CLOSED";

interface SessionInfo {
  session: Session;
  label: string;
  countdownLabel: string;
  countdown: string;
  color: string;
  dotColor: string;
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
  if (ms <= 0) return "0:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}

function getDateKey(et: Date): string {
  const y = et.getFullYear();
  const mo = (et.getMonth() + 1).toString().padStart(2, "0");
  const d = et.getDate().toString().padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function findNextTradingDay(et: Date): Date {
  const next = new Date(et);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 30, 0, 0);
  for (let i = 0; i < 10; i++) {
    const dow = next.getDay();
    const key = getDateKey(next);
    if (dow !== 0 && dow !== 6 && !NYSE_HOLIDAYS[key]) return next;
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function getSessionInfo(): SessionInfo {
  const et = getEasternTime();
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;
  const day = et.getDay();
  const isWeekend = day === 0 || day === 6;
  const dateKey = getDateKey(et);
  const holidayName = NYSE_HOLIDAYS[dateKey];
  const earlyCloseName = NYSE_EARLY_CLOSE[dateKey];

  if (isWeekend || holidayName) {
    const nextOpen = findNextTradingDay(et);
    const msLeft = nextOpen.getTime() - et.getTime();
    return {
      session: "CLOSED",
      label: "MARKET CLOSED",
      countdownLabel: "Cash opens in",
      countdown: fmtCountdown(msLeft),
      color: "#ffffff",
      dotColor: "#71717a",
    };
  }

  const PRE_OPEN = 4 * 60;
  const RTH_OPEN = 9 * 60 + 30;
  const RTH_CLOSE = earlyCloseName ? 13 * 60 : 16 * 60;
  const AH_CLOSE = earlyCloseName ? 13 * 60 : 20 * 60;

  if (mins >= RTH_OPEN && mins < RTH_CLOSE) {
    const msLeft = ((RTH_CLOSE - mins) * 60 - et.getSeconds()) * 1000;
    return {
      session: "RTH",
      label: earlyCloseName ? `MARKET OPEN — Early Close` : "MARKET OPEN",
      countdownLabel: "Closes in",
      countdown: fmtCountdown(msLeft),
      color: "#00d166",
      dotColor: "#00d166",
    };
  }

  if (mins >= PRE_OPEN && mins < RTH_OPEN) {
    const msLeft = ((RTH_OPEN - mins) * 60 - et.getSeconds()) * 1000;
    return {
      session: "PRE",
      label: "PRE-MARKET",
      countdownLabel: "Cash opens in",
      countdown: fmtCountdown(msLeft),
      color: "#FFB800",
      dotColor: "#FFB800",
    };
  }

  if (mins >= RTH_CLOSE && mins < AH_CLOSE) {
    const nextOpen = findNextTradingDay(et);
    const msLeft = nextOpen.getTime() - et.getTime();
    return {
      session: "AH",
      label: "MARKET CLOSED",
      countdownLabel: "Cash opens in",
      countdown: fmtCountdown(msLeft),
      color: "#ffffff",
      dotColor: "#71717a",
    };
  }

  const nextOpen = mins >= AH_CLOSE
    ? findNextTradingDay(et)
    : (() => { const d = new Date(et); d.setHours(9, 30, 0, 0); return d; })();
  const msLeft = nextOpen.getTime() - et.getTime();

  return {
    session: "CLOSED",
    label: "MARKET CLOSED",
    countdownLabel: "Cash opens in",
    countdown: fmtCountdown(msLeft),
    color: "#ffffff",
    dotColor: "#71717a",
  };
}

export function MarketSessionClock({ compact = false }: { compact?: boolean }) {
  const [info, setInfo] = useState<SessionInfo>(getSessionInfo);

  useEffect(() => {
    const id = setInterval(() => setInfo(getSessionInfo()), 1000);
    return () => clearInterval(id);
  }, []);

  if (compact) {
    return (
      <span
        className="ml-auto whitespace-nowrap"
        style={{
          color: "#ffcd36",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          marginRight: 4,
        }}
      >
        {info.label}
      </span>
    );
  }

  return (
    <div className="terminal-session-clock flex items-center gap-1 min-w-0 max-w-[42%] sm:max-w-none shrink ml-auto overflow-hidden">
      <span
        className="text-[13px] font-light truncate"
        style={{ color: info.color, fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "0.04em" }}
      >
        {info.label}
      </span>
      <span className="text-[#3a3a3c] text-[9px] shrink-0 hidden sm:inline">|</span>
      <span
        className="text-[11px] font-light text-[#a1a1aa] truncate hidden sm:inline"
        style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "0.04em" }}
      >
        {info.countdownLabel}
      </span>
      <span
        className="text-[14px] font-light tabular-nums truncate text-white shrink-0"
        style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "0.03em" }}
      >
        {info.countdown}
      </span>
    </div>
  );
}
