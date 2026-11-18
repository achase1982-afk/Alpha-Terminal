import { deskParseTapeTimeMs } from "./addons/unusualWhales/deskUwNetPrem.js";

function optNum(row: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (v == null || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function deskLiveFlowBarStartMsFromUwRow(row: Record<string, unknown>): number | null {
  const ms = deskParseTapeTimeMs(row.bar_start_ms ?? row.tape_time ?? row.timestamp ?? row.time);
  if (ms == null) return null;
  return Math.floor(ms / 60_000) * 60_000;
}

export type UwNpBarPayload = {
  type: "uw_np_bar";
  sym: string;
  bar_start_ms: number;
  call_prem_bought: number | null;
  call_prem_sold: number | null;
  put_prem_bought: number | null;
  put_prem_sold: number | null;
  net_call: number | null;
  net_put: number | null;
  call_volume_ask_side: number | null;
  call_volume_bid_side: number | null;
  put_volume_ask_side: number | null;
  put_volume_bid_side: number | null;
  polled_at_ms: number;
  src: "unusual_whales";
  badge: "delayed ~1m";
};

export function deskLiveFlowMapUwNetPremRow(
  row: Record<string, unknown>,
  sym: string,
  polledAtMs: number,
): UwNpBarPayload | null {
  const bar_start_ms = deskLiveFlowBarStartMsFromUwRow(row);
  if (bar_start_ms == null) return null;
  return {
    type: "uw_np_bar",
    sym: sym.toUpperCase().replace(/^\$/, ""),
    bar_start_ms,
    call_prem_bought: optNum(row, "call_prem_bought", "call_premium_ask_side", "call_ask_premium"),
    call_prem_sold: optNum(row, "call_prem_sold", "call_premium_bid_side", "call_bid_premium"),
    put_prem_bought: optNum(row, "put_prem_bought", "put_premium_ask_side", "put_ask_premium"),
    put_prem_sold: optNum(row, "put_prem_sold", "put_premium_bid_side", "put_bid_premium"),
    net_call: optNum(row, "net_call", "net_call_premium"),
    net_put: optNum(row, "net_put", "net_put_premium"),
    call_volume_ask_side: optNum(row, "call_volume_ask_side", "call_ask_volume", "call_volume_ask"),
    call_volume_bid_side: optNum(row, "call_volume_bid_side", "call_bid_volume", "call_volume_bid"),
    put_volume_ask_side: optNum(row, "put_volume_ask_side", "put_ask_volume", "put_volume_ask"),
    put_volume_bid_side: optNum(row, "put_volume_bid_side", "put_bid_volume", "put_volume_bid"),
    polled_at_ms: polledAtMs,
    src: "unusual_whales",
    badge: "delayed ~1m",
  };
}