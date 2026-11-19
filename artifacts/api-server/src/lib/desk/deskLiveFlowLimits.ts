import { getAppLevelOneEquitiesCount } from "../schwabStreamer.js";
import { deskComputeDeskEquitiesBudget } from "./deskStreamerBudget.js";
import { deskLiveFlowSseClientCountForTests, deskLiveFlowSseClientCount } from "./deskLiveFlowHub.js";
import { deskLiveFlowSubsWouldBeNewSymbol } from "./deskLiveFlowSubs.js";
import {
  deskLiveFlowFuturesContractMultiplier,
  deskLiveFlowFuturesRoot,
  deskLiveFlowFuturesSupportedRoots,
  DESK_LIVE_FLOW_FUTURES_ROOTS,
} from "./deskLiveFlowFuturesMult.js";
export const DESK_LIVE_FLOW_MAX_SSE_CLIENTS = 32;

export type DeskLiveFlowSubscribeReject =
  | { ok: true }
  | { ok: false; status: number; error: string; supported?: string[] };

const FUTURES_DISPLAY_RE = /^\/([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ]\d{2})?$/;

export type DeskLiveFlowRejectReason = {
  error: string;
  supported?: string[];
};

export function deskLiveFlowRejectSymbol(sym: string, kind: string): DeskLiveFlowRejectReason | null {
  const u = sym.trim().toUpperCase();
  if (kind === "futures") {
    if (!u.startsWith("/")) return { error: "futures_requires_slash_prefix" };
    if (!FUTURES_DISPLAY_RE.test(u)) return { error: "invalid_futures_symbol" };
    const root = deskLiveFlowFuturesRoot(u);
    if (!DESK_LIVE_FLOW_FUTURES_ROOTS.has(root)) {
      return {
        error: "futures_flow_unsupported",
        supported: deskLiveFlowFuturesSupportedRoots(),
      };
    }
    if (deskLiveFlowFuturesContractMultiplier(u) == null) {
      return {
        error: "futures_flow_unsupported",
        supported: deskLiveFlowFuturesSupportedRoots(),
      };
    }
    return null;
  }
  if (kind === "equity" || kind === "spx") {
    if (u.startsWith("./")) return { error: "invalid_symbol" };
    if (!/^\$?[A-Z][A-Z0-9.$\-/]{0,14}$/.test(u)) return { error: "invalid_symbol" };
  }
  return null;
}

export function deskLiveFlowCanSubscribe(
  sym: string,
  kind: "spx" | "equity" | "futures",
): DeskLiveFlowSubscribeReject {
  const symReject = deskLiveFlowRejectSymbol(sym, kind);
  if (symReject) {
    return {
      ok: false,
      status: 400,
      error: symReject.error,
      ...(symReject.supported ? { supported: symReject.supported } : {}),
    };
  }

  const clients = typeof deskLiveFlowSseClientCount === "function"
    ? deskLiveFlowSseClientCount()
    : deskLiveFlowSseClientCountForTests();
  if (clients >= DESK_LIVE_FLOW_MAX_SSE_CLIENTS) {
    return { ok: false, status: 429, error: "live_flow_client_cap" };
  }

  if (kind === "equity" && deskLiveFlowSubsWouldBeNewSymbol(sym, kind)) {
    const budget = deskComputeDeskEquitiesBudget(getAppLevelOneEquitiesCount());
    if (budget <= 0) {
      return { ok: false, status: 429, error: "desk_equity_streamer_budget" };
    }
  }

  return { ok: true };
}