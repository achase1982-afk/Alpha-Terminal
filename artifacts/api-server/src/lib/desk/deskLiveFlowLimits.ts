import { getAppLevelOneEquitiesCount } from "../schwabStreamer.js";
import { deskComputeDeskEquitiesBudget } from "./deskStreamerBudget.js";
import { deskLiveFlowSseClientCountForTests, deskLiveFlowSseClientCount } from "./deskLiveFlowHub.js";
import {
  deskLiveFlowSubsDistinctNonSpxCount,
  deskLiveFlowSubsWouldBeNewSymbol,
} from "./deskLiveFlowSubs.js";
import {
  deskLiveFlowFuturesContractMultiplier,
  deskLiveFlowFuturesRoot,
  DESK_LIVE_FLOW_FUTURES_ROOTS,
} from "./deskLiveFlowFuturesMult.js";
import { deskFlowNormalizeEquityKey } from "./deskLiveFlowSymbol.js";

export const DESK_LIVE_FLOW_MAX_DISTINCT_SYMBOLS = 8;
export const DESK_LIVE_FLOW_MAX_SSE_CLIENTS = 32;

export type DeskLiveFlowSubscribeReject =
  | { ok: true }
  | { ok: false; status: number; error: string };

const KNOWN_EQUITY = new Set([
  "SPX",
  "VIX",
  "RUT",
  "NDX",
  "DJX",
  "XSP",
  "OEX",
  "XLF",
  "QQQ",
  "SPY",
  "IWM",
  "DIA",
]);

/** Schwab-style month code + 2-digit year (e.g. /ESZ26). */
const FUTURES_CONTRACT_RE = /^\/[A-Z]{2,4}[FGHJKMNQUVXZ]\d{2}$/;

function isGarbageEquityTicker(sym: string): boolean {
  const s = deskFlowNormalizeEquityKey(sym);
  if (KNOWN_EQUITY.has(s)) return false;
  if (s.length > 5 && !s.includes(".")) return true;
  if (/^[A-Z]{6,}$/.test(s)) return true;
  if (/^(ABCDEF|QWERTY|ASDFGH|ZXCVBN)/.test(s)) return true;
  return false;
}

export function deskLiveFlowRejectSymbol(sym: string, kind: string): string | null {
  const u = sym.trim().toUpperCase();
  if (kind === "futures") {
    if (!u.startsWith("/")) return "futures_requires_slash_prefix";
    const root = deskLiveFlowFuturesRoot(u);
    const knownRoot = DESK_LIVE_FLOW_FUTURES_ROOTS.has(root);
    const isContract = FUTURES_CONTRACT_RE.test(u);
    if (knownRoot && u === root) return null;
    if (isContract && deskLiveFlowFuturesContractMultiplier(u) != null) return null;
    return "invalid_futures_symbol";
  }
  if (kind === "equity" || kind === "spx") {
    if (!/^\$?[A-Z][A-Z0-9.$\-]{0,11}$/.test(u)) return "invalid_symbol";
    if (isGarbageEquityTicker(u)) return "invalid_symbol";
  }
  return null;
}

export function deskLiveFlowCanSubscribe(
  sym: string,
  kind: "spx" | "equity" | "futures",
): DeskLiveFlowSubscribeReject {
  const symReject = deskLiveFlowRejectSymbol(sym, kind);
  if (symReject) return { ok: false, status: 400, error: symReject };

  const clients = typeof deskLiveFlowSseClientCount === "function"
    ? deskLiveFlowSseClientCount()
    : deskLiveFlowSseClientCountForTests();
  if (clients >= DESK_LIVE_FLOW_MAX_SSE_CLIENTS) {
    return { ok: false, status: 429, error: "live_flow_client_cap" };
  }

  if (kind !== "spx" && deskLiveFlowSubsWouldBeNewSymbol(sym, kind)) {
    const distinct = deskLiveFlowSubsDistinctNonSpxCount();
    if (distinct >= DESK_LIVE_FLOW_MAX_DISTINCT_SYMBOLS) {
      return { ok: false, status: 429, error: "live_flow_symbol_cap" };
    }
  }

  if (kind === "equity" && deskLiveFlowSubsWouldBeNewSymbol(sym, kind)) {
    const budget = deskComputeDeskEquitiesBudget(getAppLevelOneEquitiesCount());
    if (budget <= 0) {
      return { ok: false, status: 429, error: "desk_equity_streamer_budget" };
    }
  }

  return { ok: true };
}