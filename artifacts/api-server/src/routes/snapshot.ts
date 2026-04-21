import { Router } from "express";
import { runFullSnapshot, getSnapshotStatus, collectEquitySnapshots, collectPolygonFlowFromAPI, computeFlowAggregates, computeIVFromFlow, backfillEquityHistory, backfillPolygonFlow, backfillEquityFromPolygon } from "../lib/dailySnapshot";
import { cleanupIVUnits, recomputeAllIVR } from "../lib/ivNormalize";
import { startBackfillJob, getBackfillJob, listBackfillJobs, diagnoseListContracts } from "../lib/historicalIVBackfill";
import { getBestAccessToken } from "../lib/tokenStore";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { optionsFlowPerStrikeTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): { ok: boolean; error?: string } {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { ok: false, error: "ADMIN_API_KEY is not set on the server" };
  if (req.headers["x-admin-key"] !== adminKey) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

const router = Router();

router.get("/status", async (_req, res) => {
  try {
    const status = await getSnapshotStatus();
    res.json({ ok: true, snapshots: status });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post("/collect", async (req, res) => {
  const { symbols, date } = req.body as { symbols?: string[]; date?: string };
  const accessToken = req.headers["x-access-token"] as string | undefined;

  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "Missing x-access-token header" });
  }

  const scanSymbols = symbols ?? getDefaultUniverse();

  res.json({ ok: true, message: "Snapshot collection started", symbols: scanSymbols.length, date: date ?? new Date().toISOString().slice(0, 10) });

  runFullSnapshot(scanSymbols, accessToken, date).catch(e => {
    logger.error({ error: (e as Error).message }, "Background snapshot collection failed");
  });
});

router.post("/equity-only", async (req, res) => {
  const { symbols, date } = req.body as { symbols?: string[]; date?: string };
  const accessToken = req.headers["x-access-token"] as string | undefined;

  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "Missing x-access-token header" });
  }

  const scanSymbols = symbols ?? getDefaultUniverse();

  res.json({ ok: true, message: "Equity snapshot started", symbols: scanSymbols.length });

  collectEquitySnapshots(scanSymbols, accessToken, date).catch(e => {
    logger.error({ error: (e as Error).message }, "Background equity snapshot failed");
  });
});

router.post("/flow-only", async (req, res) => {
  const { symbols, date, sync } = req.body as { symbols?: string[]; date?: string; sync?: boolean };

  const scanSymbols = symbols ?? getDefaultUniverse();

  if (sync) {
    try {
      const { strikeRows } = await collectPolygonFlowFromAPI(scanSymbols, date);
      const aggRows = await computeFlowAggregates(scanSymbols, date);
      const ivRows = await computeIVFromFlow(scanSymbols, date);
      res.json({ ok: true, strikeRows, aggRows, ivRows });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
    return;
  }

  res.json({ ok: true, message: "Flow collection started", symbols: scanSymbols.length });

  collectPolygonFlowFromAPI(scanSymbols, date)
    .then(({ strikeRows }) => computeFlowAggregates(scanSymbols, date).then(aggRows =>
      computeIVFromFlow(scanSymbols, date).then(ivRows => {
        logger.info({ strikeRows, aggRows, ivRows }, "Flow-only collection complete");
      })
    ))
    .catch(e => {
      logger.error({ error: (e as Error).message }, "Background flow collection failed");
    });
});

router.post("/backfill", async (req, res) => {
  const accessToken = (req.headers["x-access-token"] as string | undefined) ?? getBestAccessToken();
  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "No Schwab access token available" });
  }

  const { symbols } = req.body as { symbols?: string[] };
  const scanSymbols = symbols ?? getDefaultUniverse();

  res.json({ ok: true, message: "Equity history backfill started", symbols: scanSymbols.length });

  backfillEquityHistory(scanSymbols, accessToken).catch(e => {
    logger.error({ error: (e as Error).message }, "Background backfill failed");
  });
});

router.post("/recompute-aggregates", async (req, res) => {
  try {
    const dateRows = await db
      .selectDistinct({ date: optionsFlowPerStrikeTable.date })
      .from(optionsFlowPerStrikeTable)
      .orderBy(optionsFlowPerStrikeTable.date);
    const dates = dateRows.map(r => r.date);

    const symRows = await db
      .selectDistinct({ sym: optionsFlowPerStrikeTable.underlyingSymbol })
      .from(optionsFlowPerStrikeTable);
    const symbols = symRows.map(r => r.sym);

    res.json({ ok: true, message: `Recomputing aggregates for ${dates.length} dates, ${symbols.length} symbols`, dates: dates.length, symbols: symbols.length });

    (async () => {
      let processed = 0;
      for (const d of dates) {
        await computeFlowAggregates(symbols, d);
        await computeIVFromFlow(symbols, d);
        processed++;
        if (processed % 10 === 0) {
          logger.info({ processed, total: dates.length }, "Recompute aggregates progress");
        }
      }
      logger.info({ processed, symbols: symbols.length }, "Recompute aggregates + IV complete");
    })().catch(e => logger.error({ error: (e as Error).message }, "Recompute aggregates failed"));
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post("/backfill-flow", async (req, res) => {
  const { symbols, daysBack, sync, force } = req.body as { symbols?: string[]; daysBack?: number; sync?: boolean; force?: boolean };
  const scanSymbols = symbols ?? getDefaultUniverse();
  const days = daysBack ?? 60;

  if (sync) {
    try {
      const result = await backfillPolygonFlow(scanSymbols, days, !!force);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  } else {
    res.json({ ok: true, message: `Polygon flow backfill started — ${days} days`, symbols: scanSymbols.length, daysBack: days, force: !!force });
    backfillPolygonFlow(scanSymbols, days, !!force).catch(e => {
      logger.error({ error: (e as Error).message }, "Background Polygon flow backfill failed");
    });
  }
});

router.post("/compute-iv", async (req, res) => {
  const { symbols, date } = req.body as { symbols?: string[]; date?: string };
  const scanSymbols = symbols ?? getDefaultUniverse();
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  res.json({ ok: true, message: `Computing IV for ${scanSymbols.length} symbols on ${targetDate}` });

  computeIVFromFlow(scanSymbols, targetDate).then(updated => {
    logger.info({ updated, date: targetDate }, "IV computation complete");
  }).catch(e => {
    logger.error({ error: (e as Error).message }, "IV computation failed");
  });
});

router.post("/backfill-equity-polygon", async (req, res) => {
  const { symbols, daysBack, sync } = req.body as { symbols?: string[]; daysBack?: number; sync?: boolean };
  const scanSymbols = symbols ?? getDefaultUniverse();
  const days = daysBack ?? 120;

  if (sync) {
    try {
      const result = await backfillEquityFromPolygon(scanSymbols, days);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  } else {
    res.json({ ok: true, message: `Polygon equity backfill started`, symbols: scanSymbols.length, daysBack: days });
    backfillEquityFromPolygon(scanSymbols, days).catch(e => {
      logger.error({ error: (e as Error).message }, "Polygon equity backfill failed");
    });
  }
});

router.post("/trigger", async (req, res) => {
  const accessToken = getBestAccessToken();
  if (!accessToken) {
    return res.status(503).json({ ok: false, error: "No Schwab access token available. Authenticate first." });
  }

  const { symbols, date } = req.body as { symbols?: string[]; date?: string };
  const scanSymbols = symbols ?? getDefaultUniverse();
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  logger.info({ symbols: scanSymbols.length, date: targetDate }, "Manual snapshot trigger: starting full collection");
  res.json({ ok: true, message: `Full snapshot triggered for ${scanSymbols.length} symbols on ${targetDate}. Running in background.`, symbols: scanSymbols.length, date: targetDate });

  runFullSnapshot(scanSymbols, accessToken, targetDate).then(result => {
    logger.info({ ...result, date: targetDate }, "Manual snapshot trigger: complete");
  }).catch(e => {
    logger.error({ error: (e as Error).message, date: targetDate }, "Manual snapshot trigger: failed");
  });
});

router.post("/admin/cleanup-iv-units", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });
  try {
    const before = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE iv_30d IS NOT NULL) AS iv_pop,
        COUNT(*) FILTER (WHERE iv_30d > 5) AS iv_pct_format,
        COUNT(*) FILTER (WHERE iv_30d IS NOT NULL AND iv_30d < 0.01) AS iv_garbage_low,
        COUNT(*) FILTER (WHERE ivr < 0 OR ivr > 100) AS ivr_out_of_range
      FROM equity_daily
    `);
    const report = await cleanupIVUnits();
    const after = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE iv_30d IS NOT NULL) AS iv_pop,
        COUNT(*) FILTER (WHERE iv_30d > 5) AS iv_pct_format,
        COUNT(*) FILTER (WHERE iv_30d IS NOT NULL AND iv_30d < 0.01) AS iv_garbage_low,
        COUNT(*) FILTER (WHERE ivr < 0 OR ivr > 100) AS ivr_out_of_range
      FROM equity_daily
    `);
    res.json({
      ok: true,
      report,
      before: (before as { rows?: unknown[] }).rows ?? before,
      after: (after as { rows?: unknown[] }).rows ?? after,
    });
  } catch (e) {
    logger.error({ error: (e as Error).message }, "cleanup-iv-units failed");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post("/admin/backfill-iv-history", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });
  const { symbols, daysBack } = (req.body ?? {}) as { symbols?: string[]; daysBack?: number };
  const syms = (symbols && symbols.length > 0) ? symbols : [...LIQUID_CORE_SYMBOLS];
  const days = (typeof daysBack === "number" && daysBack > 0 && daysBack <= 730) ? daysBack : 252;
  const job = startBackfillJob(syms, days);
  res.json({ ok: true, started: true, job });
});

router.get("/admin/backfill-iv-history/:id", (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });
  const job = getBackfillJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: "job not found" });
  res.json({ ok: true, job });
});

router.get("/admin/backfill-iv-history", (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });
  res.json({ ok: true, jobs: listBackfillJobs() });
});

router.get("/admin/diagnose-list-contracts", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });
  const symbol = String(req.query["symbol"] ?? "SPY");
  const daysBack = Math.max(1, Math.min(900, Number(req.query["daysBack"] ?? 252)));
  try {
    const result = await diagnoseListContracts(symbol, daysBack);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post("/admin/recompute-ivr", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });
  const { symbols } = (req.body ?? {}) as { symbols?: string[] };
  try {
    const result = await recomputeAllIVR(symbols);
    const sample = await db.execute(sql`
      SELECT symbol, date, iv_30d, ivr
      FROM equity_daily
      WHERE symbol IN ('SPY','QQQ','IWM','TSLA','AAPL','XLE','XLF','XLK')
        AND ivr IS NOT NULL
      ORDER BY symbol, date DESC
      LIMIT 40
    `);
    res.json({ ok: true, result, sample: (sample as { rows?: unknown[] }).rows ?? sample });
  } catch (e) {
    logger.error({ error: (e as Error).message }, "recompute-ivr failed");
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

function getDefaultUniverse(): string[] {
  return [...LIQUID_CORE_SYMBOLS];
}

export default router;
