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
  addOptionSymbols,
  addSseClient,
  getSnapshot,
  getStreamerStatus,
  isConnected,
} from "../lib/schwabStreamer.js";

const router: IRouter = Router();

// ── POST /api/stream/start ────────────────────────────────────────────────────
router.post("/start", async (req, res) => {
  const { accessToken, traderAccessToken, symbols } = req.body as {
    accessToken?: string;
    traderAccessToken?: string;
    symbols?: string[];
  };

  if (!accessToken) {
    return res.status(400).json({ error: "accessToken is required" });
  }

  const syms = Array.isArray(symbols) && symbols.length > 0
    ? symbols.map((s: string) => String(s).toUpperCase())
    : ["SPY", "QQQ", "IWM", "DIA", "VIX", "TSLA", "NVDA", "AAPL", "META", "MSFT", "AMZN", "GOOGL"];

  const streamerToken = traderAccessToken || accessToken;
  await startStreamer(streamerToken, syms);
  res.json({ ok: true, subscribedCount: syms.length, usingTraderToken: !!traderAccessToken });
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

// ── POST /api/stream/option-symbols ───────────────────────────────────────────
router.post("/option-symbols", (req, res) => {
  const { symbols } = req.body as { symbols?: string[] };
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: "symbols array is required" });
  }
  addOptionSymbols(symbols);
  res.json({ ok: true, count: symbols.length });
});

// ── GET /api/stream/quotes  (SSE) ─────────────────────────────────────────────
router.get("/quotes", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");   // disable nginx buffering
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

// ── GET /api/stream/snapshot ──────────────────────────────────────────────────
router.get("/snapshot", (_req, res) => {
  res.json({ quotes: getSnapshot(), status: getStreamerStatus() });
});

// ── GET /api/stream/status ────────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  res.json({
    connected:    isConnected(),
    cachedSymbols: getSnapshot().map(q => q.symbol),
  });
});

// ── GET /api/stream/diag — diagnose why streaming might not work ─────────────
router.get("/diag", async (req, res) => {
  const token = req.query["token"] as string | undefined;
  if (!token) {
    return res.status(400).json({ error: "token query param required" });
  }

  const results: Record<string, unknown> = {};

  try {
    const prefRes = await fetch("https://api.schwabapi.com/trader/v1/userPreference", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prefBody = await prefRes.text().catch(() => "");
    results.userPreference = {
      status: prefRes.status,
      ok: prefRes.ok,
      body: prefRes.ok ? JSON.parse(prefBody) : prefBody.slice(0, 500),
    };
  } catch (err) {
    results.userPreference = { error: String(err) };
  }

  try {
    const acctRes = await fetch("https://api.schwabapi.com/trader/v1/accounts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const acctBody = await acctRes.text().catch(() => "");
    results.accounts = {
      status: acctRes.status,
      ok: acctRes.ok,
      bodyPreview: acctBody.slice(0, 300),
    };
  } catch (err) {
    results.accounts = { error: String(err) };
  }

  try {
    const quoteRes = await fetch("https://api.schwabapi.com/marketdata/v1/SPY/quotes", {
      headers: { Authorization: `Bearer ${token}` },
    });
    results.marketData = {
      status: quoteRes.status,
      ok: quoteRes.ok,
    };
  } catch (err) {
    results.marketData = { error: String(err) };
  }

  res.json(results);
});

export default router;
