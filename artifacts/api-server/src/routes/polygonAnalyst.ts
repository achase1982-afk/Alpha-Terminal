import { Router, type IRouter } from "express";

import { fetchPolygonAnalystRatingsAndConsensus, polygonKey } from "../lib/polygonAnalystData.js";

const router: IRouter = Router();

/** GET /api/polygon/analyst-ratings?symbol=AMD&limit=300 */
router.get("/analyst-ratings", async (req, res) => {
  const key = polygonKey();
  if (!key) return res.status(503).json({ error: "POLYGON_API_KEY not configured" });

  const symbol = (req.query["symbol"] as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const limitRaw = Number(req.query["limit"] ?? 300);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 300;

  try {
    const pack = await fetchPolygonAnalystRatingsAndConsensus(symbol, limit);
    if (!pack) {
      return res.status(503).json({ error: "POLYGON_API_KEY not configured" });
    }

    const { consensus, ratings, rawCount, filteredCount, analystConsensus } = pack;

    return res.json({
      symbol: pack.symbol,
      ratings,
      consensus: {
        consensus_pt: consensus.consensus_pt,
        high_pt: consensus.high_pt,
        low_pt: consensus.low_pt,
        num_active_analysts: consensus.num_active_analysts,
        strong_buy: consensus.strong_buy,
        buy: consensus.buy,
        hold: consensus.hold,
        sell: consensus.sell,
        strong_sell: consensus.strong_sell,
      },
      upstream_records: rawCount,
      filtered_records: filteredCount,
      coverage_reason: analystConsensus.coverage_reason,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ err }, "polygon analyst-ratings error");
    return res.status(502).json({ error: msg || "upstream error" });
  }
});

export default router;
