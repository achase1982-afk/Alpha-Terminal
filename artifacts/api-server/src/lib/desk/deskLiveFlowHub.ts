import type { Response } from "express";
import {
  DESK_LIVE_FLOW_SLOW_CLIENT_HIGH_WATER,
  DESK_LIVE_FLOW_SSE_HEARTBEAT_MS,
  deskLiveFlowWsFanoutEnabled,
} from "./deskLiveFlowConfig.js";
import type { DeskFlowAssetKind } from "./deskLiveFlowSymbol.js";
import { deskLiveFlowSubsAcquire, deskLiveFlowSubsRelease } from "./deskLiveFlowSubs.js";

export type DeskLiveFlowFrame = {
  type: string;
  seq: number;
  src_ts_ms: number;
  rx_ts_ms: number;
  [key: string]: unknown;
};

let processSeq = 0;

export function deskLiveFlowNextSeq(): number {
  processSeq += 1;
  return processSeq;
}

export function deskLiveFlowResetSeqForTests(): void {
  processSeq = 0;
}

type SseClient = {
  res: Response;
  symbol: string;
  pending: string[];
  paused: boolean;
  dropped: number;
};

const sseClients = new Set<SseClient>();
let wsFanout: ((event: string, data: unknown) => void) | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function registerDeskLiveFlowWsFanout(fn: (event: string, data: unknown) => void): void {
  wsFanout = fn;
}

function ensureHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const c of sseClients) {
      try {
        c.res.write(": heartbeat\n\n");
      } catch {
        sseClients.delete(c);
      }
    }
  }, DESK_LIVE_FLOW_SSE_HEARTBEAT_MS);
  heartbeatTimer.unref?.();
}

function flushClient(c: SseClient): void {
  while (c.pending.length > 0 && !c.paused) {
    const line = c.pending[0]!;
    if (!c.res.write(line)) {
      c.paused = true;
      const onDrain = () => {
        c.paused = false;
        c.res.off("drain", onDrain);
        flushClient(c);
      };
      c.res.once("drain", onDrain);
      return;
    }
    c.pending.shift();
  }
}

function dropIfSlow(c: SseClient): void {
  let bytes = 0;
  for (const line of c.pending) bytes += line.length;
  if (bytes > DESK_LIVE_FLOW_SLOW_CLIENT_HIGH_WATER) {
    c.pending = [];
    c.dropped += 1;
    c.paused = false;
  }
}

function normFlowSym(s: string): string {
  return s.replace(/^\$/, "").toUpperCase();
}

export function deskLiveFlowBroadcastFrame(frame: DeskLiveFlowFrame): void {
  const line = `data: ${JSON.stringify(frame)}\n\n`;
  const fsym = normFlowSym(String(frame.sym ?? ""));
  for (const c of sseClients) {
    if (c.symbol !== "ALL" && normFlowSym(c.symbol) !== fsym) continue;
    c.pending.push(line);
    dropIfSlow(c);
    flushClient(c);
  }
  if (deskLiveFlowWsFanoutEnabled() && wsFanout) {
    wsFanout("desk_flow", frame);
  }
}

export function registerDeskLiveFlowSse(res: Response, symbol: string, kind: DeskFlowAssetKind): void {
  const sym =
    kind === "futures"
      ? symbol.trim().toUpperCase().startsWith("/")
        ? symbol.trim().toUpperCase()
        : `/${symbol.trim().toUpperCase()}`
      : symbol.trim().toUpperCase().replace(/^\$/, "") || "SPX";
  deskLiveFlowSubsAcquire(sym, kind);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Desk-Flow-Asset": kind,
  });
  res.write(": connected\n\n");
  const client: SseClient = { res, symbol: sym, pending: [], paused: false, dropped: 0 };
  sseClients.add(client);
  ensureHeartbeat();
  res.on("close", () => {
    sseClients.delete(client);
    deskLiveFlowSubsRelease(sym, kind);
  });
}

export function deskLiveFlowSseClientCountForTests(): number {
  return sseClients.size;
}

export function deskLiveFlowSseDroppedForTests(): number {
  let n = 0;
  for (const c of sseClients) n += c.dropped;
  return n;
}

export function wrapDeskLiveFlowFrame(
  payload: Record<string, unknown>,
  srcTsMs: number,
  rxTsMs: number,
): DeskLiveFlowFrame {
  return {
    ...payload,
    seq: deskLiveFlowNextSeq(),
    src_ts_ms: srcTsMs,
    rx_ts_ms: rxTsMs,
  } as DeskLiveFlowFrame;
}