import { getAppLevelOneEquitiesCount } from "../schwabStreamer.js";
import { deskComputeDeskEquitiesBudget } from "./deskStreamerBudget.js";
import { deskLiveFlowSseClientCountForTests, deskLiveFlowSseClientCount } from "./deskLiveFlowHub.js";
import {
  deskLiveFlowSubsDistinctNonSpxCount,
  deskLiveFlowSubsWouldBeNewSymbol,
} from "./deskLiveFlowSubs.js";

export const DESK_LIVE_FLOW_MAX_DISTINCT_SYMBOLS = 8;
export const DESK_LIVE_FLOW_MAX_SSE_CLIENTS = 32;

export type DeskLiveFlowSubscribeReject =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Reserved garbage tickers (reject before streamer SUBS). */
const REJECT_SYMBOLS = new Set(["ZZZZZZ", "/ZZZZZZ", "YYYYYY", "/YYYYYY"]);

export function deskLiveFlowRejectSymbol(sym: string, kind: string): string | null {
  const u = sym.trim().toUpperCase();
  if (REJECT_SYMBOLS.has(u)) return "invalid_symbol";
  if (kind === "futures" && !u.startsWith("/")) return "futures_requires_slash_prefix";
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

  if (kind !== "spx" && !deskLiveFlowSubsWouldBeNewSymbol(sym, kind)) {
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