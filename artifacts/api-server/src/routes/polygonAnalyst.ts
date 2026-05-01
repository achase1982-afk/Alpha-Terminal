import { Router, type IRouter } from "express";
import { fetchPolygonAnalystConsensus, fetchPolygonAnalystRatings } from "../lib/polygonAnalystData.js";

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
    const data = await fetchPolygonAnalystConsensus(symbol);
    if (data == null) {
      return res.status(502).json({ error: "polygon analyst consensus unavailable" });
    }
    return res.json(data);
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
    const data = await fetchPolygonAnalystRatings(symbol, limit);
    if (data == null) {
      return res.status(502).json({ error: "polygon analyst ratings unavailable" });
    }
    return res.json(data);
  } catch (err: any) {
    req.log?.error({ err }, "polygon analyst-ratings error");
    return res.status(502).json({ error: err?.message || "upstream error" });
  }
});

export default router;
