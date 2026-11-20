import type { Request } from "express";
import { parseDeskFlowSymbol } from "../desk/deskLiveFlowSymbol.js";
import { deskLiveFlowCanSubscribe } from "../desk/deskLiveFlowLimits.js";
import { registerDeskLiveFlowSse } from "../desk/deskLiveFlowHub.js";
import { deskLiveFlowEnabled } from "../desk/deskLiveFlowConfig.js";
import { DESK_LIVE_FLOW_SSE_HEARTBEAT_MS } from "../desk/deskLiveFlowConfig.js";
import { buildDeskHealthFeeds } from "../desk/deskFeedFreshness.js";

export const AT_FLOW_STREAMS_PER_CLIENT = 3;

const clientStreamCounts = new Map<string, number>();

export function resetAtFlowStreamClientCountsForTests(): void {
  clientStreamCounts.clear();
}

function clientKey(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const raw = typeof fwd === "string" ? fwd.split(",")[0]?.trim() : Array.isArray(fwd) ? fwd[0] : null;
  return raw ?? req.socket.remoteAddress ?? "unknown";
}

export function atFlowStreamClientCountForTests(): number {
  let n = 0;
  for (const v of clientStreamCounts.values()) n += v;
  return n;
}

export type FlowFeedRow = { feed: string; status: string };

export type FlowMetaState = { sessionClosed: boolean | null };

/** Live flow is no longer gated on the equity-options session calendar. */
export function flowSessionClosed(_feeds: readonly FlowFeedRow[], _nowMs = Date.now()): boolean {
  return false;
}

/** Writes a meta event only when the session flag changes, including closed → open. */
export function takeFlowMetaUpdate(
  state: FlowMetaState,
  sym: string,
  feeds: readonly FlowFeedRow[],
  nowMs = Date.now(),
): string | null {
  const sessionClosed = flowSessionClosed(feeds, nowMs);
  if (state.sessionClosed === sessionClosed) return null;
  state.sessionClosed = sessionClosed;
  const flowFeed = feeds.find((f) => f.feed === "uw_flow" || f.feed === "schwab_streamer");
  return `event: meta\ndata: ${JSON.stringify({
    sym,
    sessionClosed,
    flowFeedStatus: flowFeed?.status ?? null,
  })}\n\n`;
}

export function handleAtFlowStream(req: Request, res: import("express").Response): void {
  if (!deskLiveFlowEnabled()) {
    res.status(503).json({ error: "live_flow_disabled" });
    return;
  }

  const rawSym = (req.query["symbol"] as string | undefined) ?? "SPX";
  const parsed = parseDeskFlowSymbol(rawSym);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error, source: "at_flow" });
    return;
  }

  const gate = deskLiveFlowCanSubscribe(parsed.parsed.sym, parsed.parsed.kind);
  if (!gate.ok) {
    res.status(gate.status).json({
      error: gate.error,
      source: "at_flow",
      ...(gate.supported ? { supported: gate.supported } : {}),
    });
    return;
  }

  const key = clientKey(req);
  const openForClient = clientStreamCounts.get(key) ?? 0;
  if (openForClient >= AT_FLOW_STREAMS_PER_CLIENT) {
    res.status(429).json({ error: "at_flow_stream_client_cap", limit: AT_FLOW_STREAMS_PER_CLIENT });
    return;
  }

  clientStreamCounts.set(key, openForClient + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const n = (clientStreamCounts.get(key) ?? 1) - 1;
    if (n <= 0) clientStreamCounts.delete(key);
    else clientStreamCounts.set(key, n);
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  res.on("close", () => {
    if (timer) clearInterval(timer);
    release();
  });

  registerDeskLiveFlowSse(res, parsed.parsed.sym, parsed.parsed.kind);
  const meta: FlowMetaState = { sessionClosed: null };
  const publish = () => {
    try {
      const line = takeFlowMetaUpdate(meta, parsed.parsed.sym, buildDeskHealthFeeds());
      if (!line) return;
      res.write(line);
    } catch {
      if (timer) clearInterval(timer);
      release();
    }
  };
  timer = setInterval(publish, DESK_LIVE_FLOW_SSE_HEARTBEAT_MS);
  timer.unref?.();
  publish();
}