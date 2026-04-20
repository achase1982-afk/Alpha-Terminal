import { Router, type IRouter } from "express";
import { getStatus as getPolygonWsStatus, isEnabled as polygonWsEnabled } from "../lib/polygonOptionsWs.js";
import { startFlowScan, getFlowScanJob } from "../lib/polygonUnusualFlowScan.js";

const router: IRouter = Router();

// Status endpoint for health / debugging — always safe to call.
router.get("/unusual-flow/status", (_req, res) => {
  res.json({
    enabled: polygonWsEnabled(),
    polygonOptionsWs: getPolygonWsStatus(),
  });
});

// Kick off a new scan. Returns 202 + jobId.
router.post("/unusual-flow", (req, res) => {
  if (!polygonWsEnabled()) {
    res.status(503).json({
      error: "polygon_options_ws_disabled",
      message: "POLYGON_OPTIONS_WS_ENABLED must be set on the server (requires Reserved VM).",
    });
    return;
  }
  if (!process.env["POLYGON_API_KEY"]) {
    res.status(503).json({ error: "polygon_api_key_missing" });
    return;
  }

  const body = req.body as { tickers?: unknown; durationSec?: unknown; minPremium?: unknown };
  const rawTickers = Array.isArray(body?.tickers) ? body.tickers : [];
  const tickers = rawTickers
    .filter((t): t is string => typeof t === "string" && t.length > 0 && t.length <= 8)
    .map(t => t.toUpperCase())
    .slice(0, 40); // guard: max 40 tickers per scan

  if (!tickers.length) {
    res.status(400).json({ error: "no_tickers", message: "`tickers` must be a non-empty string array" });
    return;
  }

  const durationSec = typeof body?.durationSec === "number" ? body.durationSec : undefined;
  const minPremium = typeof body?.minPremium === "number" ? body.minPremium : undefined;

  const job = startFlowScan({ tickers, durationSec, minPremium });
  res.status(202).json({ jobId: job.jobId, status: job.status, durationSec: job.durationSec });
});

// Poll a running scan.
router.get("/unusual-flow/:jobId", (req, res) => {
  const job = getFlowScanJob(req.params["jobId"] as string);
  if (!job) {
    res.status(404).json({ error: "job_not_found" });
    return;
  }
  res.json(job);
});

export default router;
