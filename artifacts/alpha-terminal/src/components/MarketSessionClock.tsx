import { useState, useEffect } from "react";

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

function getSessionInfo(): SessionInfo {
  const et = getEasternTime();
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;
  const day = et.getDay();
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    const daysUntilMon = day === 0 ? 1 : 2;
    const nextOpen = new Date(et);
    nextOpen.setDate(nextOpen.getDate() + daysUntilMon);
    nextOpen.setHours(9, 30, 0, 0);
    const msLeft = nextOpen.getTime() - et.getTime();
    return {
      session: "CLOSED",
      label: "MARKET CLOSED",
      countdownLabel: "Opens in",
      countdown: fmtCountdown(msLeft),
      color: "#ffffff",
      dotColor: "#71717a",
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
      countdownLabel: "Opens in",
      countdown: fmtCountdown(msLeft),
      color: "#FFB800",
      dotColor: "#FFB800",
    };
  }

  if (mins >= RTH_CLOSE && mins < AH_CLOSE) {
    const nextOpen = new Date(et);
    nextOpen.setDate(nextOpen.getDate() + (day === 5 ? 3 : 1));
    nextOpen.setHours(9, 30, 0, 0);
    const msLeft = nextOpen.getTime() - et.getTime();
    return {
      session: "AH",
      label: "MARKET CLOSED",
      countdownLabel: "Opens in",
      countdown: fmtCountdown(msLeft),
      color: "#ffffff",
      dotColor: "#71717a",
    };
  }

  let msLeft: number;
  if (mins >= AH_CLOSE) {
    const nextOpen = new Date(et);
    nextOpen.setDate(nextOpen.getDate() + (day === 5 ? 3 : 1));
    nextOpen.setHours(9, 30, 0, 0);
    msLeft = nextOpen.getTime() - et.getTime();
  } else {
    const nextOpen = new Date(et);
    nextOpen.setHours(9, 30, 0, 0);
    msLeft = nextOpen.getTime() - et.getTime();
  }

  return {
    session: "CLOSED",
    label: "MARKET CLOSED",
    countdownLabel: "Opens in",
    countdown: fmtCountdown(msLeft),
    color: "#ffffff",
    dotColor: "#71717a",
  };
}

export function MarketSessionClock() {
  const [info, setInfo] = useState<SessionInfo>(getSessionInfo);

  useEffect(() => {
    const id = setInterval(() => setInfo(getSessionInfo()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-1 min-w-0 ml-auto">
      <span
        className="text-[13px] font-light uppercase whitespace-nowrap"
        style={{ color: info.color, fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "0.04em" }}
      >
        {info.label}
      </span>
      <span className="text-[#3a3a3c] text-[9px]">|</span>
      <span
        className="text-[11px] font-light text-[#a1a1aa] whitespace-nowrap"
        style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "0.04em" }}
      >
        {info.countdownLabel}
      </span>
      <span
        className="text-[14px] font-light tabular-nums whitespace-nowrap text-white"
        style={{ fontFamily: "Inter, system-ui, sans-serif", letterSpacing: "0.03em" }}
      >
        {info.countdown}
      </span>
    </div>
  );
}
