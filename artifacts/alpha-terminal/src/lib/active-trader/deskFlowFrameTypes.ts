/** Parsed desk live-flow SSE payloads (PR #660). */

export type DeskFlowFrameBase = {
  type: string;
  seq?: number;
  sym?: string;
  src_ts_ms?: number;
  rx_ts_ms?: number;
};

export type DeskFlow1s = DeskFlowFrameBase & {
  type: "flow_1s";
  bucket_ms: number;
  call_buy?: number;
  call_sell?: number;
  call_mid?: number;
  put_buy?: number;
  put_sell?: number;
  put_mid?: number;
  /** Absolute running totals for the ET session date. Present when the desk is accumulating the day. */
  day_session_date?: string;
  day_call_buy?: number;
  day_call_sell?: number;
  day_put_buy?: number;
  day_put_sell?: number;
};

/** Absolute call/put premium accumulated for the ET session date, including premarket. */
export type DeskFlowDay = DeskFlowFrameBase & {
  type: "flow_day";
  session_date?: string;
  call_buy?: number;
  call_sell?: number;
  put_buy?: number;
  put_sell?: number;
};

export type DeskFlow60s = DeskFlowFrameBase & {
  type: "flow_60s";
  bar_start_ms: number;
  call_buy?: number;
  call_sell?: number;
  call_mid?: number;
  put_buy?: number;
  put_sell?: number;
  put_mid?: number;
};

export type DeskFlowHeartbeat = DeskFlowFrameBase & {
  type: "flow_heartbeat";
  bucket_ms: number;
  empty?: boolean;
};

export type DeskTape1s = DeskFlowFrameBase & {
  type: "tape_1s";
  bucket_ms: number;
  buy_$?: number | null;
  sell_$?: number | null;
  mid_$?: number | null;
  buy_vol?: number;
  sell_vol?: number;
  n_prints?: number;
  futures_mult?: number | null;
};

export type DeskTape60s = DeskFlowFrameBase & {
  type: "tape_60s";
  bar_start_ms: number;
  buy_$?: number | null;
  sell_$?: number | null;
  mid_$?: number | null;
  n_prints?: number;
  futures_mult?: number | null;
};

export type DeskTapeHeartbeat = DeskFlowFrameBase & {
  type: "tape_heartbeat";
  bucket_ms: number;
  empty?: boolean;
};

export type DeskPxFrame = DeskFlowFrameBase & {
  type: "px";
  last?: number | null;
  bid?: number | null;
  ask?: number | null;
};

/** Unusual Whales 1-minute net-premium bar. tape time is bar_start_ms (UTC epoch). */
export type DeskUwNpBar = DeskFlowFrameBase & {
  type: "uw_np_bar";
  bar_start_ms: number;
  call_prem_bought?: number | null;
  call_prem_sold?: number | null;
  put_prem_bought?: number | null;
  put_prem_sold?: number | null;
  net_call?: number | null;
  net_put?: number | null;
};

export type DeskFlowFrame =
  | DeskFlow1s
  | DeskFlow60s
  | DeskFlowDay
  | DeskFlowHeartbeat
  | DeskTape1s
  | DeskTape60s
  | DeskTapeHeartbeat
  | DeskPxFrame
  | DeskUwNpBar
  | DeskFlowFrameBase;

export function parseDeskFlowFrame(raw: unknown): DeskFlowFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const t = (raw as DeskFlowFrameBase).type;
  if (typeof t !== "string" || !t) return null;
  return raw as DeskFlowFrame;
}