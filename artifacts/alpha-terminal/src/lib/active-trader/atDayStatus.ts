import type { SessionChangeDisplay } from "@/lib/atQuoteSessionChange";
import { WHITE } from "@/components/options/optionsTheme";
import { AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";

const DAY_UP = "#5df1a0";
const DAY_DOWN = "#ff7164";

export type DayStatusKind = "unavailable" | "down" | "flat" | "up";

export type DayStatusDisplay = {
  kind: DayStatusKind;
  changePct: number | null;
};

const FLAT_EPS_PCT = 0.005;

export function resolveDayStatus(session: SessionChangeDisplay): DayStatusDisplay {
  const pct = session.changePct;
  if (pct == null || !Number.isFinite(pct) || session.change == null) {
    return { kind: "unavailable", changePct: null };
  }
  if (Math.abs(pct) < FLAT_EPS_PCT) return { kind: "flat", changePct: 0 };
  if (pct < 0) return { kind: "down", changePct: pct };
  return { kind: "up", changePct: pct };
}

function formatDayPct(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "\u2212" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function dayStatusLabel(display: DayStatusDisplay): string {
  if (display.kind === "unavailable") return "DAY \u2014";
  if (display.kind === "flat") return "DAY FLAT 0.00%";
  if (display.kind === "down") return `DAY DOWN ${formatDayPct(display.changePct ?? 0)}`;
  return `DAY UP ${formatDayPct(display.changePct ?? 0)}`;
}

export function dayStatusColor(display: DayStatusDisplay): string {
  if (display.kind === "down") return DAY_DOWN;
  if (display.kind === "up") return DAY_UP;
  if (display.kind === "flat") return AT_SECONDARY;
  return WHITE;
}