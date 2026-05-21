import { Router, type IRouter } from "express";

import { fetchAnalystCoverage } from "../lib/analystCoverageService.js";

const router: IRouter = Router();

/** GET /api/polygon/analyst-ratings?symbol=AMD&limit=300 */
router.get("/analyst-ratings", async (req, res) => {
  const symbol = (req.query["symbol"] as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const limitRaw = Number(req.query["limit"] ?? 300);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 300;

  try {
    const result = await fetchAnalystCoverage(symbol, limit);

    return res.json({
      symbol: result.symbol,
      ratings: result.ratings,
      consensus: result.consensus,
      upstream_records: result.upstream_records,
      filtered_records: result.filtered_records,
      coverage_reason: result.coverage_reason,
      data_source: result.data_source,
      source_note: result.source_note,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ err }, "polygon analyst-ratings error");
    return res.status(502).json({ error: msg || "upstream error" });
  }
});

export default router;
