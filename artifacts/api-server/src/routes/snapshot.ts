import { Router } from "express";
import { runFullSnapshot, getSnapshotStatus, collectEquitySnapshots, collectPolygonFlowFromAPI, computeFlowAggregates, computeIVFromFlow, backfillEquityHistory, backfillPolygonFlow, backfillEquityFromPolygon } from "../lib/dailySnapshot";
import { getBestAccessToken } from "../lib/tokenStore";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import { optionsFlowPerStrikeTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";

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

function getDefaultUniverse(): string[] {
  return [...LIQUID_CORE_SYMBOLS];
}

export default router;
