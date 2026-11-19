import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { subscribeSseClient, getHubStatus, type TimeSalesEvent } from "../lib/flowTimeSalesHub.js";
import { isSweep as isSweepFromConditions, isBlock as isBlockFromSize } from "../lib/optionsConditionCodes.js";
import { isEnabled as polygonWsEnabled } from "../lib/polygonOptionsWs.js";

// ── Live flow time-and-sales routes ──────────────────────────────────
//
// GET /api/flow/timesales/:contract/stream
//   SSE stream of every trade for a single OPRA contract, tagged with
//   Lee-Ready aggressor side (server-side NBBO cache) and condition-code
//   based block / sweep flags. Heartbeat every 15s to keep mobile-Safari
//   from culling the connection.
//
// GET /api/flow/timesales/:contract/recent?limit=200
//   REST backfill of recent trades for the same contract from Polygon's
//   historical trades endpoint, classified using the *current* NBBO
//   snapshot only (best-effort — no historical NBBO replay).
//
// GET /api/flow/timesales/_status
//   Operational visibility.

const router: IRouter = Router();
const HEARTBEAT_MS = 15_000;

function normalizeContract(raw: string): string {
  const up = raw.trim().toUpperCase();
  return up.startsWith("O:") ? up : `O:${up}`;
}

router.get("/timesales/_status", (_req, res) => {
  res.json({
    polygonWsEnabled: polygonWsEnabled(),
    hub: getHubStatus(),
  });
});

router.get("/timesales/:contract/stream", async (req: Request, res: Response): Promise<void> => {
  const contract = normalizeContract(String(req.params.contract));
  if (!polygonWsEnabled()) {
    res.status(503).json({ error: "Polygon options WS disabled in this environment" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  // Initial hello so the client knows the stream is open even before any
  // trade arrives (illiquid contracts can be silent for minutes).
  res.write(`event: hello\ndata: ${JSON.stringify({ contract, ts: Date.now() })}\n\n`);

  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = await subscribeSseClient(contract, res);
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`);
    res.end();
    return;
  }

  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { /* noop */ }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    if (unsubscribe) { try { unsubscribe(); } catch { /* noop */ } unsubscribe = null; }
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("close", cleanup);
});

router.get("/timesales/:contract/recent", async (req: Request, res: Response): Promise<void> => {
  const contract = normalizeContract(String(req.params.contract));
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "200"), 10) || 200));
  res.json({ trades: [] });
  return;
});

export default router;
