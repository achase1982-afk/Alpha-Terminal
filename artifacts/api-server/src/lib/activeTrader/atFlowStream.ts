import type { Request } from "express";
import { parseDeskFlowSymbol } from "../desk/deskLiveFlowSymbol.js";
import { deskLiveFlowCanSubscribe } from "../desk/deskLiveFlowLimits.js";
import { registerDeskLiveFlowSse } from "../desk/deskLiveFlowHub.js";
import { deskLiveFlowEnabled } from "../desk/deskLiveFlowConfig.js";
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

  const feeds = buildDeskHealthFeeds();
  const sessionClosed = feeds.some(
    (f) =>
      (f.feed === "live_gamma_0dte" || f.feed === "uw_flow" || f.feed === "schwab_streamer") &&
      f.status === "session_closed",
  );
  const flowFeed = feeds.find((f) => f.feed === "uw_flow" || f.feed === "schwab_streamer");

  clientStreamCounts.set(key, openForClient + 1);
  const release = () => {
    const n = (clientStreamCounts.get(key) ?? 1) - 1;
    if (n <= 0) clientStreamCounts.delete(key);
    else clientStreamCounts.set(key, n);
  };

  res.on("close", release);

  registerDeskLiveFlowSse(res, parsed.parsed.sym, parsed.parsed.kind);
  try {
    res.write(
      `event: meta\ndata: ${JSON.stringify({
        sym: parsed.parsed.sym,
        sessionClosed,
        flowFeedStatus: flowFeed?.status ?? null,
      })}\n\n`,
    );
  } catch {
    release();
  }
}