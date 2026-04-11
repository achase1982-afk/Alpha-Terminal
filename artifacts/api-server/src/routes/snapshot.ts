import { Router } from "express";
import { runFullSnapshot, getSnapshotStatus, collectEquitySnapshots, collectPolygonFlowFromAPI, computeFlowAggregates, backfillEquityHistory, backfillPolygonFlow } from "../lib/dailySnapshot";
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
  const { symbols, date } = req.body as { symbols?: string[]; date?: string };
  const accessToken = req.headers["x-access-token"] as string | undefined;

  if (!accessToken) {
    return res.status(400).json({ ok: false, error: "Missing x-access-token header" });
  }

  const scanSymbols = symbols ?? getDefaultUniverse();

  res.json({ ok: true, message: "Flow collection started", symbols: scanSymbols.length });

  collectPolygonFlowFromAPI(scanSymbols, date)
    .then(({ strikeRows }) => computeFlowAggregates(scanSymbols, date).then(aggRows => {
      logger.info({ strikeRows, aggRows }, "Flow-only collection complete");
    }))
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
        processed++;
        if (processed % 10 === 0) {
          logger.info({ processed, total: dates.length }, "Recompute aggregates progress");
        }
      }
      logger.info({ processed, symbols: symbols.length }, "Recompute aggregates complete");
    })().catch(e => logger.error({ error: (e as Error).message }, "Recompute aggregates failed"));
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.post("/backfill-flow", async (req, res) => {
  const { symbols, daysBack } = req.body as { symbols?: string[]; daysBack?: number };
  const scanSymbols = symbols ?? getDefaultUniverse();
  const days = daysBack ?? 60;

  res.json({ ok: true, message: `Polygon flow backfill started — ${days} days`, symbols: scanSymbols.length, daysBack: days });

  backfillPolygonFlow(scanSymbols, days).catch(e => {
    logger.error({ error: (e as Error).message }, "Background Polygon flow backfill failed");
  });
});

function getDefaultUniverse(): string[] {
  return [...LIQUID_CORE_SYMBOLS];
}

export default router;
