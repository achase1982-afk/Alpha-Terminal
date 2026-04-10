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
import { subscribeQuoteForSymbol, isIBConnected } from "../lib/ibStreamer.js";
import { hasValidTokens } from "../lib/tokenStore.js";

const router: IRouter = Router();

const STAGGER_MS = 300;

function subscribeSymbolsToIB(symbols: unknown) {
  if (!isIBConnected()) return;
  if (!Array.isArray(symbols)) return;
  const cleaned = symbols
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map(s => s.trim().toUpperCase());
  if (!cleaned.length) return;

  subscribeQuoteForSymbol(cleaned[0]);
  for (let i = 1; i < cleaned.length; i++) {
    const sym = cleaned[i];
    setTimeout(() => subscribeQuoteForSymbol(sym), STAGGER_MS * i);
  }
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

router.post("/start", async (req, res) => {
  const { symbols } = req.body as { symbols?: unknown };
  subscribeSymbolsToSchwab(symbols);
  subscribeSymbolsToIB(symbols);
  res.json({ ok: true });
});

router.post("/symbols", (req, res) => {
  const { symbols } = req.body as { symbols?: unknown };
  subscribeSymbolsToSchwab(symbols);
  subscribeSymbolsToIB(symbols);
  res.json({ ok: true });
});

router.post("/option-symbols", (req, res) => {
  const { symbols } = req.body as { symbols?: unknown };
  if (Array.isArray(symbols)) {
    const all = symbols.filter((s): s is string => typeof s === "string");
    const futOpt = all.filter(s => s.startsWith("./"));
    const eqOpt = all.filter(s => !s.startsWith("./"));
    if (eqOpt.length > 0) addSchwabOptionSymbols(eqOpt);
    if (futOpt.length > 0) addSchwabFuturesOptionSymbols(futOpt);
  }
  res.json({ ok: true });
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
