import { Router } from "express";
import { db, polygonOptionsHistoryTable } from "@workspace/db";
import { sql, gte, desc } from "drizzle-orm";
import { syncDateRange, syncDate, getSyncStatus } from "../lib/polygonFlatFiles";
import { getTrailingUnusualFlow } from "../lib/optionsBaselines";
import { getDeepScanSnapshot, getWatcherStatus, getCoverageInfo, isWatcherEnabled } from "../lib/optionsWatcher";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Part 1.4 — Trailing unusual flow over the last N trading days.
 * Surfaces tickers (including names not in any current watchlist) whose
 * 5-day options volume runs >=2x their prior-15-day baseline.
 */
router.get("/trailing", async (req, res) => {
  try {
    // Strict numeric param parsing — Number("abc") is NaN, and Math.min/max
    // propagate NaN, which would crash the date math or silently disable
    // the ratio filter. Reject malformed input with 400. (Architect Part 1.)
    const parseNum = (v: unknown, def: number, lo: number, hi: number, name: string) => {
      if (v === undefined) return def;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`invalid ${name}: must be a finite number`);
      return Math.max(lo, Math.min(hi, n));
    };
    let recentDays: number, trailingDays: number, minRatio: number, limit: number;
    try {
      recentDays = parseNum(req.query.recentDays, 5, 1, 10, "recentDays");
      trailingDays = parseNum(req.query.trailingDays, 15, 5, 60, "trailingDays");
      minRatio = parseNum(req.query.minRatio, 2, 1, 10, "minRatio");
      limit = parseNum(req.query.limit, 50, 1, 200, "limit");
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const t0 = Date.now();
    const results = await getTrailingUnusualFlow({ recentDays, trailingDays, minRatio, limit });
    res.json({
      params: { recentDays, trailingDays, minRatio, limit },
      count: results.length,
      results,
      queryMs: Date.now() - t0,
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, "trailing unusual flow query failed");
    res.status(500).json({ error: err.message });
  }
});

/**
 * Part 2 — Watcher status + coverage state machine.
 * Surfaces LIVE / AMBER / EOD with the underlying signals so the UI can
 * render the badge without inventing thresholds client-side.
 */
router.get("/watcher", (_req, res) => {
  res.json({
    enabled: isWatcherEnabled(),
    status: getWatcherStatus(),
    coverage: getCoverageInfo(),
  });
});

/**
 * Part 3 — On-demand deep scan piggybacking on the watcher's session log.
 *
 * Returns the live session stats + recent breakout events + subscribed
 * contracts for a single ticker. If the ticker isn't currently in the
 * watchlist, returns 404 with a hint so the UI can either trigger a fresh
 * one-shot flow scan or wait for the next deterministic-scan rebalance.
 */
router.get("/deep/:ticker", (req, res) => {
  const ticker = String(req.params.ticker ?? "").trim();
  if (!ticker || ticker.length > 8) {
    return res.status(400).json({ error: "invalid_ticker" });
  }
  if (!isWatcherEnabled()) {
    return res.status(503).json({
      error: "watcher_disabled",
      message: "POLYGON_OPTIONS_WS_ENABLED is not set; deep scan unavailable.",
      coverage: getCoverageInfo(),
    });
  }
  const snap = getDeepScanSnapshot(ticker);
  if (!snap.watched) {
    return res.status(404).json({
      error: "not_watched",
      ticker: snap.ticker,
      message: "Ticker is not in the live watchlist; trigger a deterministic scan to promote it.",
      coverage: getCoverageInfo(),
    });
  }
  res.json({
    snapshot: snap,
    coverage: getCoverageInfo(),
    fetchedAt: Date.now(),
  });
});

router.get("/status", async (req, res) => {
  try {
    const status = await getSyncStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/sync", async (req, res) => {
  const { tickers = [], days = 30, date } = req.body as {
    tickers?: string[];
    days?: number;
    date?: string;
  };

  if (!process.env.POLYGON_S3_ACCESS_KEY) {
    return res.status(503).json({ error: "Polygon S3 credentials not configured" });
  }

  const boundedDays = Math.min(Math.max(1, days), 90);

  res.json({ status: "started", tickers, days: boundedDays });

  setImmediate(async () => {
    try {
      if (date) {
        const d = new Date(date);
        await syncDate(d, tickers);
        logger.info({ date, tickers }, "Polygon flat-file sync complete (single date)");
      } else {
        const endDate = new Date();
        endDate.setUTCDate(endDate.getUTCDate() - 1);
        const startDate = new Date();
        startDate.setUTCDate(startDate.getUTCDate() - boundedDays);
        const results = await syncDateRange(startDate, endDate, tickers);
        const totalRows = results.reduce((s, r) => s + r.rows, 0);
        logger.info({ days: boundedDays, tickers, totalRows }, "Polygon flat-file sync complete");
      }
    } catch (err) {
      logger.error(err, "Polygon flat-file sync error");
    }
  });
});

router.get("/activity", async (req, res) => {
  try {
    const {
      tickers,
      minRatio = "2.5",
      minVolume = "200",
      limit = "200",
    } = req.query as Record<string, string>;

    const tickerFilter = tickers
      ? tickers.split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
      : [];

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const latestDateRes = await db
      .select({ d: sql<string>`MAX(${polygonOptionsHistoryTable.tradeDate})` })
      .from(polygonOptionsHistoryTable);
    const latestDate = latestDateRes[0]?.d ?? null;

    if (!latestDate) {
      return res.json({ unusual: [], latestDate: null, count: 0, message: "No data synced yet" });
    }

    const rows = await db
      .select({
        optionSymbol: polygonOptionsHistoryTable.optionSymbol,
        ticker: polygonOptionsHistoryTable.ticker,
        strike: polygonOptionsHistoryTable.strike,
        expiry: polygonOptionsHistoryTable.expiry,
        putCall: polygonOptionsHistoryTable.putCall,
        avgVolume: sql<number>`ROUND(AVG(CASE WHEN trade_date < ${latestDate} THEN volume ELSE NULL END))`,
        dataPoints: sql<number>`COUNT(CASE WHEN trade_date < ${latestDate} THEN 1 ELSE NULL END)`,
        todayVolume: sql<number>`MAX(CASE WHEN trade_date = ${latestDate} THEN volume ELSE NULL END)`,
        todayClose: sql<number>`MAX(CASE WHEN trade_date = ${latestDate} THEN close_price ELSE NULL END)`,
        todayOI: sql<number>`MAX(CASE WHEN trade_date = ${latestDate} THEN open_interest ELSE NULL END)`,
      })
      .from(polygonOptionsHistoryTable)
      .where(gte(polygonOptionsHistoryTable.tradeDate, thirtyDaysAgo))
      .groupBy(
        polygonOptionsHistoryTable.optionSymbol,
        polygonOptionsHistoryTable.ticker,
        polygonOptionsHistoryTable.strike,
        polygonOptionsHistoryTable.expiry,
        polygonOptionsHistoryTable.putCall,
      )
      .having(sql`MAX(CASE WHEN trade_date = ${latestDate} THEN volume ELSE NULL END) IS NOT NULL`)
      .limit(5000);

    const minRatioNum = parseFloat(minRatio);
    const minVolumeNum = parseInt(minVolume);
    const limitNum = parseInt(limit);

    const unusual = rows
      .filter(r => {
        const vol = Number(r.todayVolume ?? 0);
        const avg = Number(r.avgVolume ?? 0);
        if (vol < minVolumeNum) return false;
        if (tickerFilter.length > 0 && !tickerFilter.includes(r.ticker)) return false;
        if (Number(r.dataPoints) < 3 && avg > 0) return true;
        if (avg === 0) return vol >= minVolumeNum * 3;
        return vol / avg >= minRatioNum;
      })
      .map(r => {
        const vol = Number(r.todayVolume ?? 0);
        const avg = Number(r.avgVolume ?? 0);
        const price = Number(r.todayClose ?? 0);
        return {
          ticker: r.ticker,
          optionSymbol: r.optionSymbol,
          strike: r.strike,
          expiry: r.expiry,
          putCall: r.putCall,
          todayVolume: vol,
          avgVolume30d: avg,
          volumeRatio: avg > 0 ? Math.round((vol / avg) * 10) / 10 : null,
          closePrice: price || null,
          premiumFlow: price ? Math.round(vol * price * 100) : null,
          openInterest: Number(r.todayOI ?? 0) || null,
          voiRatio: r.todayOI ? Math.round((vol / Number(r.todayOI)) * 100) / 100 : null,
          dataPoints: Number(r.dataPoints),
          latestDate,
          type: r.putCall === "C" ? "CALL" : "PUT",
        };
      })
      .sort((a, b) => {
        const ra = a.volumeRatio ?? 999;
        const rb = b.volumeRatio ?? 999;
        return rb - ra;
      })
      .slice(0, limitNum);

    res.json({ unusual, latestDate, count: unusual.length });
  } catch (err: any) {
    logger.error(err, "unusual-options activity error");
    res.status(500).json({ error: err.message });
  }
});

export default router;
