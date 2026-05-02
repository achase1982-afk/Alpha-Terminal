import { Router, type IRouter } from "express";

import {
  aggregateAnalystPriceTargets,
  fetchNativeAnalystRows,
  polygonKey,
} from "../lib/polygonAnalystData.js";

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
    const fetched = await fetchNativeAnalystRows(symbol);
    if (!fetched.ok) {
      return res.status(503).json({
        symbol,
        endpoint: fetched.endpointUrl,
        error: fetched.errorMessage ?? "polygon_native_analyst_unavailable",
        ratings: [],
        consensus: {
          consensus_pt: null,
          high_pt: null,
          low_pt: null,
          num_active_analysts: 0,
          strong_buy: 0,
          buy: 0,
          hold: 0,
          sell: 0,
          strong_sell: 0,
        },
        upstream_records: 0,
        filtered_records: 0,
      });
    }

    const { consensus, dedupedActions, rawCount, filteredCount } = aggregateAnalystPriceTargets(symbol, fetched.rows);

    const ratingsOut = dedupedActions.slice(0, limit).map((row) => ({
      id: row.id,
      firm: row.firm,
      analyst: row.analyst,
      action_type: row.action_type,
      rating_prior: row.rating_prior,
      rating_current: row.rating_current,
      pt_prior: row.pt_prior,
      pt_current: row.pt_current,
      date: row.date,
      time: row.time,
      rating_action: row.rating_action,
      price_target_action: row.price_target_action,
    }));

    return res.json({
      symbol,
      endpoint: fetched.endpointUrl,
      upstream_records: rawCount,
      filtered_records: filteredCount,
      ratings: ratingsOut,
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
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ err }, "polygon analyst-ratings error");
    return res.status(502).json({ error: msg || "upstream error" });
  }
});

export default router;
