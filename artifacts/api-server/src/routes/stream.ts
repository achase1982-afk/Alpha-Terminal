import { Router, type IRouter } from "express";
import {
  addSseClient,
  getSnapshot,
  getStreamerStatus,
  isConnected,
  addSymbols as addSchwabSymbols,
  addFuturesSymbols as addSchwabFuturesSymbols,
  addOptionSymbols as addSchwabOptionSymbols,
  addFuturesOptionSymbols as addSchwabFuturesOptionSymbols,
  startStreamer,
} from "../lib/schwabStreamer.js";
import {
  getStreamerSubscriptionHealth,
  streamerSubRelease,
  streamerSubReleaseByPrefix,
  streamerSubTouch,
} from "../lib/streamerSubscriptionManager.js";
import type { Request } from "express";
import { hasValidTokens } from "../lib/tokenStore.js";

const router: IRouter = Router();

function streamClientId(req: Request): string {
  const header = req.headers["x-client-session"];
  if (typeof header === "string" && header.trim()) return header.trim().slice(0, 64);
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0]!.trim();
  return req.socket?.remoteAddress ?? "anon";
}

function subscribeSymbolsToSchwab(symbols: unknown) {
  if (!Array.isArray(symbols)) return;
  const cleaned = symbols
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map(s => s.trim().toUpperCase());
  if (!cleaned.length) return;

  const futures = cleaned.filter(s => s.startsWith("/"));
  const equities = cleaned.filter(s => !s.startsWith("/"));

  if (!isConnected() && hasValidTokens("trader")) {
    void startStreamer(undefined, equities);
  } else if (equities.length > 0) {
    addSchwabSymbols(equities);
  }

  if (futures.length > 0) {
    addSchwabFuturesSymbols(futures);
  }
}

router.get("/health", (_req, res) => {
  res.json({
    streamer_status: getStreamerStatus(),
    connected: isConnected(),
    streamer_subscriptions: getStreamerSubscriptionHealth(),
  });
});

router.post("/start", async (req, res) => {
  const { symbols } = req.body as { symbols?: unknown };
  subscribeSymbolsToSchwab(symbols);
  res.json({ ok: true });
});

router.post("/symbols", (req, res) => {
  const { symbols } = req.body as { symbols?: unknown };
  subscribeSymbolsToSchwab(symbols);
  res.json({ ok: true });
});

router.post("/option-symbols", (req, res) => {
  const body = req.body as { symbols?: unknown; purpose?: unknown; holderId?: unknown };
  const purpose = typeof body.purpose === "string" && body.purpose.trim() ? body.purpose.trim() : "watchlist";
  const holderId =
    typeof body.holderId === "string" && body.holderId.trim()
      ? body.holderId.trim().slice(0, 120)
      : `stream:${streamClientId(req)}:${purpose}`;
  if (Array.isArray(body.symbols)) {
    const all = body.symbols.filter((s): s is string => typeof s === "string");
    const futOpt = all.filter((s) => s.startsWith("./"));
    const eqOpt = all.filter((s) => !s.startsWith("./"));
    if (eqOpt.length > 0) addSchwabOptionSymbols(eqOpt, holderId);
    if (futOpt.length > 0) addSchwabFuturesOptionSymbols(futOpt);
    streamerSubTouch(holderId);
  }
  res.json({ ok: true, holderId });
});

router.post("/release-holds", async (req, res) => {
  const body = req.body as { holderId?: unknown; holderPrefix?: unknown };
  if (typeof body.holderId === "string" && body.holderId.trim()) {
    await streamerSubRelease(body.holderId.trim());
    res.json({ ok: true });
    return;
  }
  const prefix =
    typeof body.holderPrefix === "string" && body.holderPrefix.trim()
      ? body.holderPrefix.trim()
      : `stream:${streamClientId(req)}:`;
  const released = await streamerSubReleaseByPrefix(prefix);
  res.json({ ok: true, released });
});

router.get("/quotes", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  } catch {}

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 8_000);

  const cleanup = addSseClient(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    cleanup();
  });
});

router.get("/snapshot", (_req, res) => {
  res.json({ quotes: getSnapshot(), status: getStreamerStatus() });
});

router.get("/status", (_req, res) => {
  res.json({
    connected:    isConnected(),
    cachedSymbols: getSnapshot().map(q => q.symbol),
  });
});

export default router;
