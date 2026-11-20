import { Router, type IRouter, type Request } from "express";
import {
  addSseClient,
  getSnapshot,
  getStrategistTimesalePoints,
  getStreamerStatus,
  isConnected,
  addSymbols as addSchwabSymbols,
  addFuturesSymbols as addSchwabFuturesSymbols,
  addOptionSymbols as addSchwabOptionSymbols,
  addFuturesOptionSymbols as addSchwabFuturesOptionSymbols,
  setClientEquityTape,
  startStreamer,
} from "../lib/schwabStreamer.js";
import {
  STREAM_HOLDER_ID_MAX_LEN,
  getStreamerSubscriptionHealth,
  streamerSubRelease,
  streamerSubSetChainUnderlyingPrice,
  streamerSubTouch,
} from "../lib/streamerSubscriptionManager.js";
import { hasValidTokens } from "../lib/tokenStore.js";
import {
  addCalendarDaysNy,
  nyCalendarYmd,
  nyOffsetForYmd,
} from "../lib/usEquityMarketCalendar.js";

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

  // Always remember the symbols. Webull market data polls this set even when
  // Schwab has no trader token, which used to drop the subscription entirely.
  if (equities.length > 0) addSchwabSymbols(equities);
  if (!isConnected() && hasValidTokens("trader")) {
    void startStreamer(undefined, equities);
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

router.post("/equity-tape", async (req, res) => {
  const { symbols } = req.body as { symbols?: unknown };
  if (!Array.isArray(symbols)) {
    res.status(400).json({ ok: false, error: "symbols required" });
    return;
  }
  const cleaned = [
    ...new Set(
      symbols
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().toUpperCase()),
    ),
  ];
  setClientEquityTape(cleaned);

  // A newly opened ladder must not start today's volume profile at zero.
  // Seed every print from the current NY calendar day—without market-hours
  // cutoffs—then continue incrementing the same buckets over SSE.
  const sessionDate = nyCalendarYmd(new Date());
  const nextDate = addCalendarDaysNy(sessionDate, 1);
  const dayStartMs = new Date(`${sessionDate}T00:00:00${nyOffsetForYmd(sessionDate)}`).getTime();
  const dayEndMs = new Date(`${nextDate}T00:00:00${nyOffsetForYmd(nextDate)}`).getTime();
  const throughMs = Math.min(Date.now(), dayEndMs);
  const volumeByPrice: Record<string, Record<string, number>> = {};
  for (const symbol of cleaned) {
    const profile: Record<string, number> = {};
    const sessionPoints = getStrategistTimesalePoints(symbol).filter(
      (point) => point.ts >= dayStartMs && point.ts < throughMs,
    );
    for (const point of sessionPoints) {
      const key = point.price.toFixed(2);
      profile[key] = (profile[key] ?? 0) + point.size;
    }
    volumeByPrice[symbol] = profile;
  }
  res.json({
    ok: true,
    count: cleaned.length,
    sessionDate,
    volumeByPrice,
  });
});

router.post("/option-symbols", (req, res) => {
  const body = req.body as Record<string, unknown>;
  const clientId = resolveClientId(req, body);
  if (!clientId) {
    res.status(400).json({ ok: false, error: "clientId required (body.clientId or x-stream-client-id)" });
    return;
  }
  const purpose = typeof body.purpose === "string" && body.purpose.trim() ? body.purpose.trim() : "watchlist";
  const viewId = typeof body.viewId === "string" && body.viewId.trim() ? body.viewId.trim() : "";
  const holderIdRaw =
    typeof body.holderId === "string" && body.holderId.trim()
      ? body.holderId.trim()
      : viewId
        ? `stream:${clientId}:${purpose}:${viewId}`
        : `stream:${clientId}:${purpose}`;
  if (holderIdRaw.length > STREAM_HOLDER_ID_MAX_LEN) {
    res.status(400).json({ ok: false, error: "holderId too long" });
    return;
  }
  const holderId = holderIdRaw;
  if (!holderId.startsWith(`stream:${clientId}:`)) {
    res.status(400).json({ ok: false, error: "holderId must belong to clientId" });
    return;
  }
  if (viewId.length > STREAM_HOLDER_ID_MAX_LEN) {
    res.status(400).json({ ok: false, error: "viewId too long" });
    return;
  }
  const expectedHolder = viewId
    ? `stream:${clientId}:${purpose}:${viewId}`
    : `stream:${clientId}:${purpose}`;
  if (typeof body.holderId === "string" && body.holderId.trim() && holderId !== expectedHolder) {
    res.status(400).json({ ok: false, error: "holderId must match clientId, purpose, and viewId" });
    return;
  }
  const underlyingPrice =
    typeof body.underlyingPrice === "number" && Number.isFinite(body.underlyingPrice)
      ? body.underlyingPrice
      : null;
  if (underlyingPrice != null && purpose === "chain" && viewId.startsWith("chain:")) {
    const root = viewId.split(":")[1]?.replace(/^\$/, "").toUpperCase();
    if (root) streamerSubSetChainUnderlyingPrice(root, underlyingPrice);
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
