import { Router, type IRouter } from "express";
import {
  addSseClient,
  getSnapshot,
  getStreamerStatus,
  isConnected,
} from "../lib/schwabStreamer.js";
import { subscribeQuoteForSymbol, isIBConnected } from "../lib/ibStreamer.js";

const router: IRouter = Router();

function subscribeSymbolsToIB(symbols: unknown) {
  if (!isIBConnected()) return;
  if (!Array.isArray(symbols)) return;
  for (const sym of symbols) {
    if (typeof sym === "string" && sym.trim()) {
      subscribeQuoteForSymbol(sym.trim().toUpperCase());
    }
  }
}

router.post("/start", async (req, res) => {
  const { symbols } = req.body as { symbols?: unknown };
  subscribeSymbolsToIB(symbols);
  res.json({ ok: true, subscribedCount: 0, message: "IB only" });
});

router.post("/symbols", (req, res) => {
  const { symbols } = req.body as { symbols?: unknown };
  subscribeSymbolsToIB(symbols);
  res.json({ ok: true });
});

router.post("/option-symbols", (_req, res) => {
  res.json({ ok: true, count: 0 });
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
