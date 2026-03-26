/**
 * /api/stream — real-time price streaming via Server-Sent Events (SSE).
 *
 * POST /api/stream/start      — start/update the Schwab Streamer WS connection
 * POST /api/stream/symbols    — add symbols to an existing subscription
 * GET  /api/stream/quotes     — SSE endpoint; browser connects here for live prices
 * GET  /api/stream/snapshot   — one-shot JSON snapshot of the current cache
 * GET  /api/stream/status     — connection health
 */

import { Router, type IRouter } from "express";
import {
  startStreamer,
  addSymbols,
  addSseClient,
  getSnapshot,
  isConnected,
} from "../lib/schwabStreamer.js";

const router: IRouter = Router();

// ── POST /api/stream/start ────────────────────────────────────────────────────
router.post("/start", async (req, res) => {
  const { accessToken, symbols } = req.body as {
    accessToken?: string;
    symbols?: string[];
  };

  if (!accessToken) {
    return res.status(400).json({ error: "accessToken is required" });
  }

  const syms = Array.isArray(symbols) && symbols.length > 0
    ? symbols.map((s: string) => String(s).toUpperCase())
    : ["SPY", "QQQ", "IWM", "DIA", "VIX", "TSLA", "NVDA", "AAPL", "META", "MSFT", "AMZN", "GOOGL"];

  await startStreamer(accessToken, syms);
  res.json({ ok: true, subscribedCount: syms.length });
});

// ── POST /api/stream/symbols ──────────────────────────────────────────────────
router.post("/symbols", (req, res) => {
  const { symbols } = req.body as { symbols?: string[] };
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: "symbols array is required" });
  }
  addSymbols(symbols.map((s: string) => String(s).toUpperCase()));
  res.json({ ok: true });
});

// ── GET /api/stream/quotes  (SSE) ─────────────────────────────────────────────
router.get("/quotes", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");   // disable nginx buffering
  res.flushHeaders();

  // Heartbeat every 25s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  const cleanup = addSseClient(res);

  req.on("close", () => {
    clearInterval(heartbeat);
    cleanup();
  });
});

// ── GET /api/stream/snapshot ──────────────────────────────────────────────────
router.get("/snapshot", (_req, res) => {
  res.json({ quotes: getSnapshot() });
});

// ── GET /api/stream/status ────────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  res.json({
    connected:    isConnected(),
    cachedSymbols: getSnapshot().map(q => q.symbol),
  });
});

export default router;
