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

export type DeskFlowFrame =
  | DeskFlow1s
  | DeskFlow60s
  | DeskFlowHeartbeat
  | DeskTape1s
  | DeskTape60s
  | DeskTapeHeartbeat
  | DeskPxFrame
  | DeskFlowFrameBase;

export function parseDeskFlowFrame(raw: unknown): DeskFlowFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const t = (raw as DeskFlowFrameBase).type;
  if (typeof t !== "string" || !t) return null;
  return raw as DeskFlowFrame;
}