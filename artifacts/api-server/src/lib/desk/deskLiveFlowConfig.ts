import { deskEnvTruthyDefault } from "./deskEnv.js";
import { deskUwAddonEnabled } from "./addons/unusualWhales/deskUwEnabled.js";

export function deskLiveFlowEnabled(): boolean {
  return deskEnvTruthyDefault(true, "DESK_LIVE_FLOW_ENABLED", "LIVE_FLOW_ENABLED");
}

export function deskLiveFlowPxEnabled(): boolean {
  if (!deskLiveFlowEnabled()) return false;
  return deskEnvTruthyDefault(true, "DESK_LIVE_FLOW_PX", "LIVE_FLOW_PX");
}

export function deskLiveFlowUwBarsEnabled(): boolean {
  if (!deskLiveFlowEnabled()) return false;
  if (!deskUwAddonEnabled()) return false;
  return deskEnvTruthyDefault(true, "DESK_LIVE_FLOW_UW_BARS", "LIVE_FLOW_UW_BARS");
}

export function deskLiveFlowL1oEnabled(): boolean {
  if (!deskLiveFlowEnabled()) return false;
  return deskEnvTruthyDefault(true, "DESK_LIVE_FLOW_L1O", "LIVE_FLOW_L1O");
}

export function deskLiveFlowWsFanoutEnabled(): boolean {
  if (!deskLiveFlowEnabled()) return false;
  return deskEnvTruthyDefault(false, "DESK_LIVE_FLOW_WS_FANOUT", "LIVE_FLOW_WS_FANOUT");
}

/** Diagnostic: TIMESALE_OPTIONS on 5 near-ATM SPXW 0DTE (off by default). */
export function deskLiveFlowTimesaleDebugEnabled(): boolean {
  if (!deskLiveFlowEnabled()) return false;
  return deskEnvTruthyDefault(false, "DESK_LIVE_FLOW_TIMESALE_DEBUG", "LIVE_FLOW_TIMESALE_DEBUG");
}

export const DESK_LIVE_FLOW_PX_MAX_PER_SEC = 4;
export const DESK_LIVE_FLOW_SSE_HEARTBEAT_MS = 15_000;
export const DESK_LIVE_FLOW_SLOW_CLIENT_HIGH_WATER = 256 * 1024;
/** Max trade–receive skew before bucketing on receive time (ms). */
export const DESK_LIVE_FLOW_TAPE_REORDER_MS = 750;
export const DESK_LIVE_FLOW_QUOTE_HISTORY_CAP = 64;