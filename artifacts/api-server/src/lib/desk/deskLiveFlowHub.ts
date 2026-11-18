import type { Response } from "express";
import {
  DESK_LIVE_FLOW_SLOW_CLIENT_HIGH_WATER,
  DESK_LIVE_FLOW_SSE_HEARTBEAT_MS,
  deskLiveFlowWsFanoutEnabled,
} from "./deskLiveFlowConfig.js";
import type { DeskFlowAssetKind } from "./deskLiveFlowSymbol.js";
import { deskFlowEquityWireKeysMatch } from "./deskLiveFlowSymbol.js";
import {
  deskLiveFlowSubsAcquire,
  deskLiveFlowSubsRelease,
  deskLiveFlowSubsSymbolActive,
} from "./deskLiveFlowSubs.js";
import { deskLiveFlowTapeDropSymbol } from "./deskLiveFlowTape.js";

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
  kind: DeskFlowAssetKind;
  pending: string[];
  paused: boolean;
  dropped: number;
  onDrain: (() => void) | null;
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
      if (c.onDrain) c.res.off("drain", c.onDrain);
      const onDrain = () => {
        c.paused = false;
        if (c.onDrain) c.res.off("drain", c.onDrain);
        c.onDrain = null;
        flushClient(c);
      };
      c.onDrain = onDrain;
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
    if (c.onDrain) {
      c.res.off("drain", c.onDrain);
      c.onDrain = null;
    }
    c.pending = [];
    c.dropped += 1;
    c.paused = false;
    try {
      const resync = `event: resync\ndata: ${JSON.stringify({
        sym: c.symbol,
        reason: "slow_client_drop",
        dropped_frames: c.dropped,
      })}\n\n`;
      c.res.write(resync);
    } catch {
      sseClients.delete(c);
    }
  }
}

function normFlowSym(s: string): string {
  return s.replace(/^\$/, "").toUpperCase();
}

function frameMatchesClient(client: SseClient, frameSym: string): boolean {
  if (client.symbol === "ALL") return true;
  if (client.kind === "equity") return deskFlowEquityWireKeysMatch(client.symbol, frameSym);
  return normFlowSym(client.symbol) === normFlowSym(frameSym);
}

export function deskLiveFlowBroadcastFrame(frame: DeskLiveFlowFrame): void {
  const fsym = String(frame.sym ?? "");
  for (const c of sseClients) {
    if (!frameMatchesClient(c, fsym)) continue;
    const outbound =
      c.kind === "equity" && c.symbol !== fsym
        ? ({ ...frame, sym: c.symbol } as DeskLiveFlowFrame)
        : frame;
    const line = `data: ${JSON.stringify(outbound)}\n\n`;
    c.pending.push(line);
    dropIfSlow(c);
    flushClient(c);
  }
  if (deskLiveFlowWsFanoutEnabled() && wsFanout) {
    wsFanout("desk_flow", frame);
  }
}

function deskLiveFlowOnClientDisconnect(symbol: string, kind: DeskFlowAssetKind): void {
  deskLiveFlowSubsRelease(symbol, kind);
  if (kind !== "spx" && !deskLiveFlowSubsSymbolActive(symbol, kind)) {
    deskLiveFlowTapeDropSymbol(symbol, kind);
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
  const client: SseClient = { res, symbol: sym, kind, pending: [], paused: false, dropped: 0, onDrain: null };
  sseClients.add(client);
  ensureHeartbeat();
  res.on("close", () => {
    sseClients.delete(client);
    deskLiveFlowOnClientDisconnect(sym, kind);
  });
}

/** Vitest: SSE close path without a live Response. */
export function __deskLiveFlowOnClientDisconnectForTests(symbol: string, kind: DeskFlowAssetKind): void {
  deskLiveFlowOnClientDisconnect(symbol, kind);
}

export function deskLiveFlowSseClientCountForTests(): number {
  return sseClients.size;
}

export function deskLiveFlowSseClientCount(): number {
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