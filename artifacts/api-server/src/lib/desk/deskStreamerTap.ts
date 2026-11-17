import type { Response } from "express";
import {
  deskClearStreamerEvicted,
  deskMarkStreamerEvicted,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { deskSessionDateEt } from "./deskEt.js";
import { deskUtcEpochNsJson } from "./deskUtcNs.js";
import { logger } from "../logger.js";

export type DeskStreamerFrame = {
  rx_ns: string;
  c: number;
  dir?: "out";
  m: Record<string, unknown> | unknown[] | string | number | boolean | null;
  session_date: string;
  rx_utc_ms: number;
};

const sseClients = new Set<Response>();
let connectionNumber = 0;
const normalizedRing: Array<{ symbol: string; last: number | null; bid: number | null; ask: number | null; ts_ms: number }> =
  [];

const DESK_EQ_KEYS = new Set(["$SPX", "SPY", "$VIX"]);
const RING_CAP = 50_000;

function parseSchwabFrame(raw: string): DeskStreamerFrame["m"] {
  try {
    return JSON.parse(raw) as DeskStreamerFrame["m"];
  } catch {
    return { _desk_parse_error: true, _raw: raw };
  }
}

function broadcastFrame(frame: DeskStreamerFrame): void {
  const line = `data: ${JSON.stringify(frame)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch {
      sseClients.delete(res);
    }
  }
}

function maybeTouchFeedsFromFrame(raw: string, rxMs: number): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }

  deskTouchFeed("schwab_streamer", rxMs, "schwab");

  const data = msg["data"] as Array<{ service?: string; content?: Record<string, unknown>[] }> | undefined;
  if (!data) return;

  for (const item of data) {
    const svc = item.service ?? "";
    if (svc === "LEVELONE_EQUITIES" && item.content) {
      for (const row of item.content) {
        const key = String(row["key"] ?? "");
        if (!DESK_EQ_KEYS.has(key)) continue;
        const last = num(row["3"]);
        const bid = num(row["1"]);
        const ask = num(row["2"]);
        const tsMs = num(row["34"]) ?? rxMs;
        deskTouchFeed("schwab_quotes_rest", tsMs, "schwab");
        pushNormalized(key.replace(/^\$/, ""), last, bid, ask, tsMs);
      }
    }
  }
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pushNormalized(
  symbol: string,
  last: number | null,
  bid: number | null,
  ask: number | null,
  tsMs: number,
): void {
  normalizedRing.push({ symbol, last, bid, ask, ts_ms: tsMs });
  if (normalizedRing.length > RING_CAP) normalizedRing.splice(0, normalizedRing.length - RING_CAP);
}

function wrapFrame(raw: string, dir?: "out"): DeskStreamerFrame {
  const rxMs = Date.now();
  return {
    rx_ns: deskUtcEpochNsJson(),
    c: connectionNumber,
    ...(dir ? { dir } : {}),
    m: parseSchwabFrame(raw),
    session_date: deskSessionDateEt(new Date(rxMs)),
    rx_utc_ms: rxMs,
  };
}

export function onSchwabConnectionOpened(): void {
  connectionNumber += 1;
  deskClearStreamerEvicted();
}

export function onSchwabInboundFrame(raw: string): void {
  const frame = wrapFrame(raw);
  broadcastFrame(frame);
  maybeTouchFeedsFromFrame(raw, frame.rx_utc_ms);
}

export function onSchwabOutboundFrame(raw: string): void {
  broadcastFrame(wrapFrame(raw, "out"));
}

export function onSchwabEvictedYielded(): void {
  logger.warn("Desk: Schwab streamer notify/code 12 — yielding connection slot");
  deskMarkStreamerEvicted();
}

export function registerDeskSpxSse(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
}

export function getDeskNormalizedTapeSince(sinceMs?: number): typeof normalizedRing {
  if (sinceMs == null || !Number.isFinite(sinceMs)) return normalizedRing.slice(-500);
  return normalizedRing.filter((t) => t.ts_ms > sinceMs);
}

export function initDeskStreamerSymbols(): void {
  void import("../schwabStreamer.js").then(({ addSymbols, isConnected }) => {
    if (!isConnected() && process.env.DESK_STREAMER_ENABLED !== "true") return;
    addSymbols(["$SPX", "SPY", "$VIX"]);
  });
}

export function deskSubscribeAtmZeroDteOptionKeys(keys: string[]): void {
  if (!keys.length) return;
  void import("../schwabStreamer.js").then(({ addOptionSymbols }) => {
    addOptionSymbols(keys.slice(0, 100));
  });
}

export function getDeskStreamerConnectionNumber(): number {
  return connectionNumber;
}