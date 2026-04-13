import app from "./app";
import { logger } from "./lib/logger";
import { injectExternalQuote, startStreamer as startSchwabStreamer, onTokenRefreshed as schwabTokenRefreshed, addFuturesSymbols, addSymbols as addSchwabSymbols } from "./lib/schwabStreamer";
import { initWsServer, broadcastToClients } from "./lib/wsServer";
import { connectIB, registerQuoteCacheInjector, registerIBBroadcast, getWsBridgeUrl } from "./lib/ibStreamer";
import { startIBWsProxy } from "./lib/ibWsProxy";
import { initTokenStore, setTokenRefreshCallback, hasValidTokens } from "./lib/tokenStore";
import { initSyntheticDxy } from "./lib/syntheticDxy";
import { startExitMonitor } from "./lib/exitStaging";
import { startTelemetryCleanup } from "./lib/telemetry";
import { initDeltaEngine } from "./lib/deltaEngine";
import { runDailyScreenRefresh } from "./routes/scanner";
import { initAiLabOrchestrator } from "./lib/aiLabOrchestrator";
import { startUniverseRebuildSchedule } from "./lib/universeBuilder";
import { updateEquityDailyFromGroupedBars, runFullSnapshot } from "./lib/dailySnapshot";
import { LIQUID_CORE_SYMBOLS } from "./data/liquidCore130";
import { db, equityDailyTable } from "@workspace/db";
import { inArray, desc, sql } from "drizzle-orm";
import { startPolygonPCRatioPoller } from "./lib/polygonPutCallRatio";
import { migrateAiLabSeedData } from "./lib/aiLabMigration";
import { getBestAccessToken } from "./lib/tokenStore";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function boot() {
  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });

  server.timeout = 120_000;
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 125_000;

  initWsServer(server);

  await initTokenStore();
  startExitMonitor();
  startTelemetryCleanup();
  initDeltaEngine();

  function scheduleDailyScreenRefresh() {
    const now = new Date();
    const etOffset = -5;
    const utcTarget = new Date(now);
    utcTarget.setUTCHours(8 - etOffset, 0, 0, 0);
    if (utcTarget.getTime() <= now.getTime()) {
      utcTarget.setUTCDate(utcTarget.getUTCDate() + 1);
    }
    const msUntil = utcTarget.getTime() - now.getTime();
    logger.info({ msUntil, targetUTC: utcTarget.toISOString() }, "Scheduling daily screen refresh");
    setTimeout(() => {
      void runDailyScreenRefresh();
      setInterval(() => void runDailyScreenRefresh(), 24 * 60 * 60 * 1000);
    }, msUntil);
  }
  scheduleDailyScreenRefresh();

  function scheduleDailySnapshot() {
    const US_MARKET_HOLIDAYS_2026 = [
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
      "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
      "2026-11-26", "2026-12-25",
    ];

    function isTradingDay(d: Date): boolean {
      const day = d.getUTCDay();
      if (day === 0 || day === 6) return false;
      const iso = d.toISOString().slice(0, 10);
      return !US_MARKET_HOLIDAYS_2026.includes(iso);
    }

    function scheduleNext() {
      const now = new Date();
      const target = new Date(now);
      target.setUTCHours(21, 30, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      while (!isTradingDay(target)) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      const ms = target.getTime() - now.getTime();
      logger.info({ targetUTC: target.toISOString(), msUntil: ms }, "Daily snapshot scheduled (4:30 PM ET)");

      setTimeout(() => {
        void runDailySnapshotJob();
        scheduleNext();
      }, ms);
    }

    async function runDailySnapshotJob() {
      const token = getBestAccessToken();
      if (!token) {
        logger.warn("Daily snapshot: no Schwab token available — skipping");
        return;
      }
      const symbols = [...LIQUID_CORE_SYMBOLS];
      const dateStr = new Date().toISOString().slice(0, 10);
      logger.info({ symbols: symbols.length, date: dateStr }, "Daily snapshot: starting LC130 collection");
      try {
        const result = await runFullSnapshot(symbols, token, dateStr);
        logger.info({ ...result, date: dateStr }, "Daily snapshot: LC130 collection complete");
      } catch (err) {
        logger.error({ err }, "Daily snapshot: LC130 collection failed");
      }
    }

    scheduleNext();
  }
  scheduleDailySnapshot();
  await migrateAiLabSeedData();
  initAiLabOrchestrator();
  startUniverseRebuildSchedule();

  const SCHWAB_FUTURES_SYMS = [
    "/ES", "/NQ", "/YM", "/RTY",
    "/GC", "/CL", "/BZ", "/HG", "/SI", "/NG", "/RB", "/PL",
    "/ZB", "/ZN", "/ZF", "/ZT", "/ZQ",
    "/6E", "/6J", "/6B", "/6A", "/6C",
    "/BTC", "/ETH",
    "/UB", "/ZC", "/ZS", "/ZW",
    "/MES", "/MNQ", "/M2K",
  ];

  const SCHWAB_FUTURES_INDEX_SYMS: string[] = [];

  const SCHWAB_EQUITY_SYMS = [
    "SPY", "QQQ", "IWM",
    "$VIX", "$VVIX", "$VIX1D", "$VIX9D", "$VIX3M",
    "$SPX", "$NDX", "$RUT", "$DJI", "$SOX",
    "$TNX", "$TYX", "$IRX",
    "$VXN", "$RVX", "$OVX", "$GVZ",
    "$TICK", "$TICKI",
    "HYG", "LQD", "IEF", "TLT",
  ];

  let backfillTriggered = false;
  async function triggerLiquidCoreBackfill() {
    if (backfillTriggered) return;
    backfillTriggered = true;
    const symbols = [...LIQUID_CORE_SYMBOLS];

    try {
      const sampleSymbols = symbols.slice(0, 10);
      const perSymbolCounts = await db
        .select({
          sym: equityDailyTable.symbol,
          cnt: sql<number>`count(distinct date)`,
        })
        .from(equityDailyTable)
        .where(inArray(equityDailyTable.symbol, sampleSymbols))
        .groupBy(equityDailyTable.symbol);

      const minDateCount = perSymbolCounts.length < sampleSymbols.length
        ? 0
        : Math.min(...perSymbolCounts.map(r => Number(r.cnt)));
      const existingDateCount = minDateCount;

      const MIN_HISTORY_DAYS = 60;
      const needsDeepBackfill = existingDateCount < MIN_HISTORY_DAYS;
      const targetDays = needsDeepBackfill ? 90 : 5;
      const scanLimit = needsDeepBackfill ? 130 : 10;

      const tradingDates: string[] = [];
      const now = Date.now();
      for (let i = 1; i <= scanLimit && tradingDates.length < targetDays; i++) {
        const d = new Date(now - i * 86_400_000);
        const dow = d.getUTCDay();
        if (dow !== 0 && dow !== 6) {
          tradingDates.push(d.toISOString().slice(0, 10));
        }
      }

      logger.info({
        count: symbols.length,
        existingDateCount,
        mode: needsDeepBackfill ? "initial_backfill" : "incremental",
        dates: tradingDates.length,
        range: `${tradingDates[tradingDates.length - 1]} → ${tradingDates[0]}`,
      }, "Auto-triggering grouped daily equity update via Polygon");

      await updateEquityDailyFromGroupedBars(symbols, tradingDates);

      const postCheck = await db
        .select({
          sym: equityDailyTable.symbol,
          cnt: sql<number>`count(distinct date)`,
        })
        .from(equityDailyTable)
        .where(inArray(equityDailyTable.symbol, sampleSymbols))
        .groupBy(equityDailyTable.symbol);
      const postMin = postCheck.length > 0 ? Math.min(...postCheck.map(r => Number(r.cnt))) : 0;
      logger.info({
        symbolsChecked: postCheck.length,
        minDaysAcrossSample: postMin,
        scannerRequirement: 60,
        ready: postMin >= 60,
      }, "Equity backfill: post-backfill coverage check");
    } catch (err) {
      backfillTriggered = false;
      logger.warn({ err }, "Grouped daily equity update failed");
    }
  }

  triggerLiquidCoreBackfill();

  setTokenRefreshCallback((kind, _accessToken) => {
    if (kind === "trader" || kind === "market") {
      addFuturesSymbols([...SCHWAB_FUTURES_SYMS, ...SCHWAB_FUTURES_INDEX_SYMS]);
      if (SCHWAB_EQUITY_SYMS.length > 0) addSchwabSymbols(SCHWAB_EQUITY_SYMS);
      schwabTokenRefreshed();
      initSyntheticDxy();
    }
  });

  registerQuoteCacheInjector(injectExternalQuote);
  registerIBBroadcast(broadcastToClients);

  if (hasValidTokens("trader")) {
    logger.info("Schwab tokens available — starting Schwab streamer with futures + indices");
    startSchwabStreamer().then(() => {
      addFuturesSymbols([...SCHWAB_FUTURES_SYMS, ...SCHWAB_FUTURES_INDEX_SYMS]);
      if (SCHWAB_EQUITY_SYMS.length > 0) addSchwabSymbols(SCHWAB_EQUITY_SYMS);
      initSyntheticDxy();
    }).catch((err) => logger.warn({ err }, "Schwab streamer start failed"));
  } else {
    logger.info("Schwab tokens not yet available — streamer will start on token refresh");
  }

  startPolygonPCRatioPoller();

  if (process.env.IBKR_GATEWAY_URL || process.env.IB_HOST) {
    const wsUrl = getWsBridgeUrl();
    if (wsUrl) {
      logger.info({ wsUrl }, "IB Gateway configured via WebSocket bridge — starting local proxy");
      startIBWsProxy(wsUrl)
        .then(() => connectIB())
        .catch((err) => logger.warn({ err }, "IB WS proxy/connect failed (will retry)"));
    } else {
      logger.info("IB Gateway configured — auto-connecting directly");
      connectIB().catch((err) => logger.warn({ err }, "IB auto-connect failed (will retry)"));
    }
  }
}

boot().catch((err) => {
  logger.error({ err }, "Failed to boot server");
  process.exit(1);
});
