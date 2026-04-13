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
import { backfillEquityHistory } from "./lib/dailySnapshot";
import { LIQUID_CORE_SYMBOLS } from "./data/liquidCore130";

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
  initAiLabOrchestrator();
  startUniverseRebuildSchedule();

  setTokenRefreshCallback((kind, _accessToken) => {
    if (kind === "trader" || kind === "market") {
      schwabTokenRefreshed();
      initSyntheticDxy();
    }
  });

  registerQuoteCacheInjector(injectExternalQuote);
  registerIBBroadcast(broadcastToClients);

  const SCHWAB_FUTURES_SYMS = [
    "/ES", "/NQ", "/YM", "/RTY",
    "/GC", "/CL", "/BZ", "/HG", "/SI", "/NG", "/RB", "/PL",
    "/ZB", "/ZN", "/ZF", "/ZT", "/ZQ",
    "/6E", "/6J", "/6B", "/6A", "/6C",
    "/VIX", "/BTC", "/ETH",
    "/UB", "/ZC", "/ZS", "/ZW",
    "/MES", "/MNQ", "/M2K",
  ];

  const SCHWAB_FUTURES_INDEX_SYMS: string[] = [];

  const SCHWAB_EQUITY_SYMS = [
    "$VIX", "$VVIX", "$VIX1D", "$VIX9D", "$VIX3M",
    "$SPX", "$NDX", "$RUT", "$DJI", "$SOX",
    "$TNX", "$TYX", "$IRX",
    "$VXN", "$RVX", "$OVX", "$GVZ",
    "$TICK", "$TICKI",
    "HYG", "LQD", "IEF", "TLT",
  ];

  let backfillTriggered = false;
  function triggerLiquidCoreBackfill() {
    if (backfillTriggered) return;
    backfillTriggered = true;
    const symbols = [...LIQUID_CORE_SYMBOLS];
    logger.info({ count: symbols.length }, "Auto-triggering Liquid Core 130 equity backfill");
    backfillEquityHistory(symbols, 60).catch((err) => {
      backfillTriggered = false;
      logger.warn({ err }, "Liquid Core backfill failed — will retry on next token refresh");
    });
  }

  if (hasValidTokens("trader")) {
    logger.info("Schwab tokens available — starting Schwab streamer with futures + indices");
    startSchwabStreamer().then(() => {
      addFuturesSymbols([...SCHWAB_FUTURES_SYMS, ...SCHWAB_FUTURES_INDEX_SYMS]);
      if (SCHWAB_EQUITY_SYMS.length > 0) addSchwabSymbols(SCHWAB_EQUITY_SYMS);
      initSyntheticDxy();
      triggerLiquidCoreBackfill();
    }).catch((err) => logger.warn({ err }, "Schwab streamer start failed"));
  } else {
    logger.info("Schwab tokens not yet available — streamer will start on token refresh");
  }

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
