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
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "POLYGON_API_KEY not set" });
    return;
  }

  // Polygon historical trades — today only.
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://api.polygon.io/v3/trades/${encodeURIComponent(contract)}?timestamp.gte=${today}&order=desc&limit=${limit}&apiKey=${apiKey}`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      res.status(502).json({ error: `Polygon REST failed: ${r.status}` });
      return;
    }
    const data = await r.json() as { results?: Array<Record<string, unknown>> };
    const rows = Array.isArray(data.results) ? data.results : [];

    // Best-effort classification using the current cached NBBO (we don't
    // replay historical NBBO). Aggressor will be "neutral" when no NBBO
    // snapshot is available yet — that's honest.
    const { getNbbo } = await import("../lib/polygonOptionsWs.js");
    const nbbo = getNbbo(contract) ?? null;
    const trades: TimeSalesEvent[] = rows.map((r) => {
      const price = Number(r["price"] ?? 0);
      const conditions = Array.isArray(r["conditions"]) ? (r["conditions"] as number[]) : [];
      const ts = Number(r["sip_timestamp"] ?? r["participant_timestamp"] ?? 0) / 1_000_000; // ns→ms
      let aggressor: "buy" | "sell" | "neutral" = "neutral";
      if (nbbo) {
        const mid = (nbbo.bid + nbbo.ask) / 2;
        if (price > mid + 1e-9) aggressor = "buy";
        else if (price < mid - 1e-9) aggressor = "sell";
      }
      return {
        sym: contract,
        price,
        size: Number(r["size"] ?? 0),
        ts,
        exchange: Number(r["exchange"] ?? 0),
        conditions,
        aggressor,
        nbbo: nbbo ? { bid: nbbo.bid, ask: nbbo.ask, ts: nbbo.ts } : null,
        isBlock: isBlockFromSize(Number(r["size"] ?? 0)),
        isSweep: isSweepFromConditions(conditions),
      };
    });

    // Polygon returned newest-first; reverse so the client gets oldest→newest
    // (matching the live SSE order).
    trades.reverse();
    res.json({ contract, trades });
  } catch (err) {
    logger.error({ err, contract }, "flowTimeSales: REST backfill failed");
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
