import { Router, type IRouter } from "express";

const POLYGON_BASE = "https://api.polygon.io";

const router: IRouter = Router();

function polygonKey(): string | null {
  const k = process.env["POLYGON_API_KEY"];
  return k && k.length > 0 ? k : null;
}

type RatingBucket = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

interface RawRatingRow {
  id: string;
  firm: string;
  analyst: string;
  action_type: string;
  rating_prior: string | null;
  rating_current: string | null;
  pt_prior: number | null;
  pt_current: number | null;
  date: string;
  time: string | null;
  rating_action: string | null;
  price_target_action: string | null;
  action_company: string | null;
}

function parseActionDate(dateStr: string, timeStr: string | null): Date | null {
  if (!dateStr) return null;
  const t = timeStr && /^\d{1,2}:\d{2}/.test(timeStr) ? timeStr : "12:00:00";
  const d = new Date(`${dateStr}T${t.length === 5 ? `${t}:00` : t}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapRatingToBucket(rating: string | null | undefined): RatingBucket | null {
  if (!rating) return null;
  const s = rating.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/(strong\s*buy|conviction\s*buy|top\s*pick)/.test(s)) return "strong_buy";
  if (/(strong\s*sell)/.test(s)) return "strong_sell";
  if (/(^buy|outperform|overweight|positive|accumulat|sector\s*outperform)/.test(s)) return "buy";
  if (/(^sell|underperform|under\s*weight|reduce)/.test(s)) return "sell";
  if (/(hold|neutral|market\s*perform|sector\s*perform|equal[\s-]*weight|in[\s-]*line|peer\s*perform|mixed)/.test(s)) {
    return "hold";
  }
  if (s.includes("buy")) return "buy";
  if (s.includes("sell")) return "sell";
  return "hold";
}

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

/** GET /api/polygon/analyst-ratings?symbol=AMD&limit=300 */
router.get("/analyst-ratings", async (req, res) => {
  const key = polygonKey();
  if (!key) return res.status(503).json({ error: "POLYGON_API_KEY not configured" });

  const symbol = (req.query["symbol"] as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const limitRaw = Number(req.query["limit"] ?? 300);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 300;

  try {
    const url = `${POLYGON_BASE}/benzinga/v1/ratings?ticker=${encodeURIComponent(symbol)}&limit=${limit}&sort=date.desc&apiKey=${encodeURIComponent(key)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: `polygon ${r.status}`, detail: text.slice(0, 200) });
    }
    const data = await r.json() as { results?: Array<Record<string, unknown>> };
    const rawRows = data.results || [];

    const actions: RawRatingRow[] = rawRows.map((row) => {
      const ratingAction = typeof row["rating_action"] === "string" ? row["rating_action"] : "";
      const ptAction = typeof row["price_target_action"] === "string" ? row["price_target_action"] : "";
      const ac = typeof row["action_company"] === "string" ? row["action_company"] : null;
      const pt = typeof row["price_target"] === "number" ? row["price_target"] : null;

      return {
        id: String(row["benzinga_id"] ?? row["id"] ?? ""),
        firm: typeof row["firm"] === "string" ? row["firm"] : "",
        analyst: typeof row["analyst"] === "string" ? row["analyst"] : "",
        action_type: normalizeAction(ratingAction, ptAction),
        rating_prior: typeof row["previous_rating"] === "string" ? row["previous_rating"] : null,
        rating_current: typeof row["rating"] === "string" ? row["rating"] : null,
        pt_prior: typeof row["previous_price_target"] === "number" ? row["previous_price_target"] : null,
        pt_current: pt,
        date: typeof row["date"] === "string" ? row["date"] : "",
        time: typeof row["time"] === "string" ? row["time"] : null,
        rating_action: ratingAction || null,
        price_target_action: ptAction || null,
        action_company: ac,
      };
    });

    const now = Date.now();
    const cutoff = now - 120 * 24 * 60 * 60 * 1000;

    const filtered = actions.filter((row) => {
      const ad = parseActionDate(row.date, row.time);
      if (!ad || ad.getTime() < cutoff) return false;

      const ac = (row.action_company || "").trim();
      const rc = (row.rating_current || "").trim();
      if (ac.toLowerCase() === "downgrades" && !rc) return false;

      const pt = row.pt_current;
      if (pt == null || typeof pt !== "number" || !Number.isFinite(pt) || pt <= 0) return false;

      return true;
    });

    const filteredSorted = [...filtered].sort((a, b) => {
      const da = parseActionDate(a.date, a.time)?.getTime() ?? 0;
      const db = parseActionDate(b.date, b.time)?.getTime() ?? 0;
      return db - da;
    });

    const byFirm = new Map<string, RawRatingRow>();
    for (const row of filteredSorted) {
      const firmKey = row.firm.trim().toLowerCase();
      if (!firmKey) continue;
      const prev = byFirm.get(firmKey);
      const curD = parseActionDate(row.date, row.time);
      const prevD = prev ? parseActionDate(prev.date, prev.time) : null;
      if (!prev || (curD && prevD && curD > prevD)) byFirm.set(firmKey, row);
    }

    const deduped = Array.from(byFirm.values()).sort((a, b) => {
      const da = parseActionDate(a.date, a.time)?.getTime() ?? 0;
      const db = parseActionDate(b.date, b.time)?.getTime() ?? 0;
      return db - da;
    });

    const pts = deduped.map(r => r.pt_current!).filter(p => p > 0 && Number.isFinite(p));
    const consensus_pt = pts.length > 0 ? pts.reduce((s, v) => s + v, 0) / pts.length : null;
    const high_pt = pts.length > 0 ? Math.max(...pts) : null;
    const low_pt = pts.length > 0 ? Math.min(...pts) : null;
    const num_active_analysts = deduped.length;

    const dist: Record<RatingBucket, number> = {
      strong_buy: 0, buy: 0, hold: 0, sell: 0, strong_sell: 0,
    };
    for (const row of deduped) {
      const b = mapRatingToBucket(row.rating_current);
      if (b) dist[b] += 1;
    }

    const ratingsOut = deduped.map((row) => ({
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
      ratings: ratingsOut,
      consensus: {
        consensus_pt,
        high_pt,
        low_pt,
        num_active_analysts,
        strong_buy: dist.strong_buy,
        buy: dist.buy,
        hold: dist.hold,
        sell: dist.sell,
        strong_sell: dist.strong_sell,
      },
    });
  } catch (err: any) {
    req.log?.error({ err }, "polygon analyst-ratings error");
    return res.status(502).json({ error: err?.message || "upstream error" });
  }
});

export default router;
