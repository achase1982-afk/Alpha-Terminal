import { Router, type IRouter } from "express";

const POLYGON_BASE = "https://api.polygon.io";

const router: IRouter = Router();

function polygonKey(): string | null {
  const k = process.env["POLYGON_API_KEY"];
  return k && k.length > 0 ? k : null;
}

/** GET /api/polygon/analyst-consensus?symbol=AMD */
router.get("/analyst-consensus", async (req, res) => {
  const key = polygonKey();
  if (!key) return res.status(503).json({ error: "POLYGON_API_KEY not configured" });

  const symbol = (req.query["symbol"] as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const url = `${POLYGON_BASE}/benzinga/v1/consensus-ratings/${encodeURIComponent(symbol)}?apiKey=${encodeURIComponent(key)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `polygon ${r.status}`, detail: text.slice(0, 200) });
    }
    const data = await r.json() as { results?: Array<Record<string, unknown>>; status?: string };
    const row = data.results?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      return res.json({
        symbol,
        consensus_price_target: null,
        high_pt: null,
        low_pt: null,
        num_analysts: null,
        strong_buy: null,
        buy: null,
        hold: null,
        sell: null,
        strong_sell: null,
        raw: null,
      });
    }

    return res.json({
      symbol,
      consensus_price_target: typeof row["consensus_price_target"] === "number" ? row["consensus_price_target"] : null,
      high_pt: typeof row["high_price_target"] === "number" ? row["high_price_target"] : null,
      low_pt: typeof row["low_price_target"] === "number" ? row["low_price_target"] : null,
      num_analysts: typeof row["ratings_contributors"] === "number" ? row["ratings_contributors"] : null,
      strong_buy: typeof row["strong_buy_ratings"] === "number" ? row["strong_buy_ratings"] : null,
      buy: typeof row["buy_ratings"] === "number" ? row["buy_ratings"] : null,
      hold: typeof row["hold_ratings"] === "number" ? row["hold_ratings"] : null,
      sell: typeof row["sell_ratings"] === "number" ? row["sell_ratings"] : null,
      strong_sell: typeof row["strong_sell_ratings"] === "number" ? row["strong_sell_ratings"] : null,
      consensus_rating: typeof row["consensus_rating"] === "string" ? row["consensus_rating"] : null,
      consensus_rating_value: typeof row["consensus_rating_value"] === "number" ? row["consensus_rating_value"] : null,
    });
  } catch (err: any) {
    req.log?.error({ err }, "polygon analyst-consensus error");
    return res.status(502).json({ error: err?.message || "upstream error" });
  }
});

/** GET /api/polygon/analyst-ratings?symbol=AMD&limit=50 */
router.get("/analyst-ratings", async (req, res) => {
  const key = polygonKey();
  if (!key) return res.status(503).json({ error: "POLYGON_API_KEY not configured" });

  const symbol = (req.query["symbol"] as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const limitRaw = Number(req.query["limit"] ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 50;

  try {
    const url = `${POLYGON_BASE}/benzinga/v1/ratings?ticker=${encodeURIComponent(symbol)}&limit=${limit}&sort=date.desc&apiKey=${encodeURIComponent(key)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `polygon ${r.status}`, detail: text.slice(0, 200) });
    }
    const data = await r.json() as { results?: Array<Record<string, unknown>> };
    const rows = data.results || [];

    const actions = rows.map((row) => {
      const ratingAction = typeof row["rating_action"] === "string" ? row["rating_action"] : "";
      const ptAction = typeof row["price_target_action"] === "string" ? row["price_target_action"] : "";
      const actionType = normalizeAction(ratingAction, ptAction);

      return {
        id: String(row["benzinga_id"] ?? row["id"] ?? ""),
        firm: typeof row["firm"] === "string" ? row["firm"] : "",
        analyst: typeof row["analyst"] === "string" ? row["analyst"] : "",
        action_type: actionType,
        rating_prior: typeof row["previous_rating"] === "string" ? row["previous_rating"] : null,
        rating_current: typeof row["rating"] === "string" ? row["rating"] : null,
        pt_prior: typeof row["previous_price_target"] === "number" ? row["previous_price_target"] : null,
        pt_current: typeof row["price_target"] === "number" ? row["price_target"] : null,
        date: typeof row["date"] === "string" ? row["date"] : "",
        time: typeof row["time"] === "string" ? row["time"] : null,
        rating_action: ratingAction || null,
        price_target_action: ptAction || null,
      };
    });

    return res.json({ symbol, ratings: actions });
  } catch (err: any) {
    req.log?.error({ err }, "polygon analyst-ratings error");
    return res.status(502).json({ error: err?.message || "upstream error" });
  }
});

function normalizeAction(ratingAction: string, ptAction: string): string {
  const ra = ratingAction.toLowerCase();
  if (ra.includes("initiate")) return "initiated";
  if (ra.includes("upgrade")) return "upgraded";
  if (ra.includes("downgrade")) return "downgraded";
  if (ra.includes("maintain") || ra.includes("reiterat")) return "maintained";
  const pta = ptAction.toLowerCase();
  if (pta.includes("raise") || pta.includes("lower") || pta.includes("set") || pta.includes("announc")) {
    return pta.includes("raise") ? "pt_raised" : pta.includes("lower") ? "pt_lowered" : "pt_updated";
  }
  return ratingAction ? ratingAction.replace(/_/g, " ") : (ptAction || "action");
}

export default router;
