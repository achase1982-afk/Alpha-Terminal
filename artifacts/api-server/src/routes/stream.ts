import { Router, type IRouter, type Request } from "express";
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
  streamerSubTouch,
} from "../lib/streamerSubscriptionManager.js";
import { hasValidTokens } from "../lib/tokenStore.js";

const router: IRouter = Router();

function resolveClientId(req: Request, body: Record<string, unknown>): string | null {
  const fromBody = body.clientId;
  if (typeof fromBody === "string" && fromBody.trim().length >= 8) {
    return fromBody.trim().slice(0, 64);
  }
  const header = req.headers["x-stream-client-id"];
  if (typeof header === "string" && header.trim().length >= 8) {
    return header.trim().slice(0, 64);
  }
  return null;
}

function subscribeSymbolsToSchwab(symbols: unknown) {
  if (!Array.isArray(symbols)) return;
  const cleaned = symbols
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().toUpperCase());
  if (!cleaned.length) return;

  const futures = cleaned.filter((s) => s.startsWith("/"));
  const equities = cleaned.filter((s) => !s.startsWith("/"));

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
  const body = req.body as Record<string, unknown>;
  const clientId = resolveClientId(req, body);
  if (!clientId) {
    res.status(400).json({ ok: false, error: "clientId required (body.clientId or x-stream-client-id)" });
    return;
  }
  const purpose = typeof body.purpose === "string" && body.purpose.trim() ? body.purpose.trim() : "watchlist";
  const viewId = typeof body.viewId === "string" && body.viewId.trim() ? body.viewId.trim().slice(0, 80) : "";
  const holderId =
    typeof body.holderId === "string" && body.holderId.trim()
      ? body.holderId.trim().slice(0, 120)
      : `stream:${clientId}:${purpose}${viewId ? `:${viewId}` : ""}`;
  if (!holderId.startsWith(`stream:${clientId}:`)) {
    res.status(400).json({ ok: false, error: "holderId must belong to clientId" });
    return;
  }
  if (Array.isArray(body.symbols)) {
    const all = body.symbols.filter((s): s is string => typeof s === "string");
    const futOpt = all.filter((s) => s.startsWith("./"));
    const eqOpt = all.filter((s) => !s.startsWith("./"));
    if (eqOpt.length > 0) addSchwabOptionSymbols(eqOpt, holderId);
    if (futOpt.length > 0) addSchwabFuturesOptionSymbols(futOpt);
    streamerSubTouch(holderId);
  }
  res.json({ ok: true, holderId, clientId });
});

router.post("/touch-hold", (req, res) => {
  const body = req.body as Record<string, unknown>;
  const clientId = resolveClientId(req, body);
  if (!clientId) {
    res.status(400).json({ ok: false, error: "clientId required" });
    return;
  }
  const holderId = typeof body.holderId === "string" ? body.holderId.trim() : "";
  if (!holderId || !holderId.startsWith(`stream:${clientId}:`)) {
    res.status(400).json({ ok: false, error: "holderId must belong to clientId" });
    return;
  }
  streamerSubTouch(holderId);
  res.json({ ok: true });
});

router.post("/release-holds", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const clientId = resolveClientId(req, body);
  if (!clientId) {
    res.status(400).json({ ok: false, error: "clientId required" });
    return;
  }
  const allowedPrefix = `stream:${clientId}:`;
  if (typeof body.holderId === "string" && body.holderId.trim()) {
    const holderId = body.holderId.trim();
    if (!holderId.startsWith(allowedPrefix)) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }
    await streamerSubRelease(holderId);
    res.json({ ok: true });
    return;
  }
  const prefix = typeof body.holderPrefix === "string" ? body.holderPrefix.trim() : allowedPrefix;
  if (!prefix.startsWith(allowedPrefix) || prefix === "stream:" || prefix === `stream:${clientId}`) {
    res.status(400).json({ ok: false, error: "invalid holderPrefix" });
    return;
  }
  const { streamerSubReleaseByPrefix } = await import("../lib/streamerSubscriptionManager.js");
  const released = await streamerSubReleaseByPrefix(prefix);
  res.json({ ok: true, released });
});

router.get("/quotes", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
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
    connected: isConnected(),
    cachedSymbols: getSnapshot().map((q) => q.symbol),
  });
});

export default router;
