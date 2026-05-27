import "./loadEnv.js";
import app from "./app";
import { logger } from "./lib/logger";
import { injectExternalQuote, startStreamer as startSchwabStreamer, onTokenRefreshed as schwabTokenRefreshed, addFuturesSymbols, addSymbols as addSchwabSymbols, isConnected as isSchwabConnected } from "./lib/schwabStreamer";
import { initWsServer, broadcastToClients } from "./lib/wsServer";
import { connectIB, registerQuoteCacheInjector, registerIBBroadcast, getWsBridgeUrl } from "./lib/ibStreamer";
import { startIBWsProxy } from "./lib/ibWsProxy";
import { initTokenStore, setTokenRefreshCallback, hasValidTokens } from "./lib/tokenStore";
import { initSyntheticDxy } from "./lib/syntheticDxy";
import { startExitMonitor } from "./lib/exitStaging";
import { startTelemetryCleanup } from "./lib/telemetry";
import { startTelemetryRetentionJob } from "./lib/telemetryRetention.js";
import { initDeltaEngine } from "./lib/deltaEngine";
import { runDailyScreenRefresh } from "./routes/scanner";
import { initAiLabOrchestrator } from "./lib/aiLabOrchestrator";
import { startUniverseRebuildSchedule } from "./lib/universeBuilder";
import { runFullSnapshot, sweepStaleSnapshots } from "./lib/dailySnapshot";
import { accumulateCanonicalIvForDate } from "./lib/canonicalIvAccumulator";
import {
  backfillAnalystEstimates,
  backfillAnalystGrades,
  backfillAnalystPriceTargets,
  backfillEarningsSurprises,
  backfillEconomicCalendar,
} from "./lib/fmpBackfill.js";
import { runFmpEarningsBackfill } from "./lib/fmpEarningsBackfill.js";
import { getFmpApiKeyOrThrow } from "./lib/fmpClient.js";
import { refreshMacroCalendarCacheFromDb } from "./lib/fmpMacroCalendarCache.js";
import { LIQUID_CORE_SYMBOL_STRINGS } from "./data/liquidCore130";
import { db, eq, snapshotCollectionLogTable, trackedTickersTable } from "@workspace/db";
import { startPolygonPCRatioPoller } from "./lib/polygonPutCallRatio";
import { startOptionsWatcher } from "./lib/optionsWatcher";
import { migrateAiLabSeedData } from "./lib/aiLabMigration";
import { getBestAccessToken } from "./lib/tokenStore";
import { loadAiLabConfigFromDb } from "./lib/aiLabConfig";
import { recoverOrphanedIvrJobs } from "./lib/onDemandIvrBackfill";
import { startSnapshotRefreshWorker } from "./lib/snapshotRefreshWorker.js";
import {
  getTuningUniverseSymbols,
  registerPersistentSchwabTuningStreaming,
  registerTuningUniverseOnBoot,
} from "./lib/tuningUniverseRegistrar.js";
import { nyCalendarYmd, isNyTradingSessionDateSync } from "./lib/usEquityMarketCalendar.js";
import { liquidCoreUnionTuningSymbols } from "./lib/liquidCoreUniverse.js";
import { runLiquidCoreEquityBackfillOnce, runFlowBootstrapGapRepairOnce } from "./lib/triggerBackfillBoot.js";
import { ensureTelemetryEventsServiceColumn } from "./lib/ensureTelemetryEventsSchema.js";
import { startMoversPollWorker } from "./lib/movers/moversPollWorker.js";
import { startCatalystsRebuildWorker } from "./lib/catalysts/catalystsRebuildWorker.js";
import { startCatalystEarningsHarvestWorker } from "./lib/catalysts/catalystEarningsHarvestWorker.js";
import { ensureMoversFeedTable } from "./lib/ensureMoversFeedSchema.js";
import { ensureCatalystsFeedTable } from "./lib/ensureCatalystsFeedSchema.js";
import { ensureCatalystEarningsDatesTable } from "./lib/ensureCatalystEarningsDatesSchema.js";
import { ensureMoversCatalystCacheTable } from "./lib/ensureMoversCatalystCacheSchema.js";
import { ensureMoversTier2CacheTable } from "./lib/ensureMoversTier2CacheSchema.js";

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

getFmpApiKeyOrThrow();

async function boot() {
  await ensureTelemetryEventsServiceColumn();
  await ensureMoversFeedTable();
  await ensureCatalystsFeedTable();
  await ensureCatalystEarningsDatesTable();
  await ensureMoversCatalystCacheTable();
  await ensureMoversTier2CacheTable();
  registerTuningUniverseOnBoot();
  startSnapshotRefreshWorker();
  startMoversPollWorker();
  void startCatalystEarningsHarvestWorker();
  const { ensureCatalystGateSettingsLoaded } = await import("./routes/catalysts.js");
  await ensureCatalystGateSettingsLoaded();
  startCatalystsRebuildWorker();
  void refreshMacroCalendarCacheFromDb().catch((e) => {
    logger.warn({ err: e }, "FMP macro calendar cache warm failed");
  });
  function scheduleCanonicalIvAccumulator() {
    function nextRunMs() {
      const now = new Date();
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22, 0, 0));
      if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
      return target.getTime() - now.getTime();
    }
    function scheduleNext() {
      const ms = nextRunMs();
      logger.info({ msUntil: ms }, "Canonical IV + FMP daily backfills scheduled (22:00 UTC daily)");
      setTimeout(async () => {
        try {
          const today = new Date().toISOString().slice(0, 10);
          const report = await accumulateCanonicalIvForDate(today);
          logger.info(report, "Canonical IV accumulator: scheduled run complete");
        } catch (err) {
          logger.error({ err }, "Canonical IV accumulator: scheduled run failed");
        }
        try {
          const fmpReport = await runFmpEarningsBackfill();
          logger.info(fmpReport, "FMP earnings backfill: scheduled run complete");
        } catch (err) {
          logger.error({ err }, "FMP earnings backfill: scheduled run failed");
        }
        try {
          const macroReport = await backfillEconomicCalendar();
          logger.info(macroReport, "FMP macro calendar backfill: scheduled run complete");
        } catch (err) {
          logger.error({ err }, "FMP macro calendar backfill: scheduled run failed");
        }
        scheduleNext();
      }, ms);
    }
    scheduleNext();
  }

  function scheduleFmpWeeklyBackfills() {
    function msUntilNextSunday2300Utc(): number {
      const now = new Date();
      const dow = now.getUTCDay();
      let addDays = (7 - dow) % 7;
      if (addDays === 0) {
        const today2300 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 0, 0));
        if (now.getTime() >= today2300.getTime()) addDays = 7;
      }
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + addDays, 23, 0, 0));
      return Math.max(1000, target.getTime() - now.getTime());
    }
    function scheduleNextWeekly() {
      const ms = msUntilNextSunday2300Utc();
      logger.info({ msUntil: ms }, "FMP weekly analyst/surprises backfill scheduled (Sunday 23:00 UTC)");
      setTimeout(async () => {
        try {
          const pt = await backfillAnalystPriceTargets();
          logger.info(pt, "FMP analyst price targets backfill: scheduled run complete");
        } catch (err) {
          logger.error({ err }, "FMP analyst price targets backfill: scheduled run failed");
        }
        try {
          const gr = await backfillAnalystGrades();
          logger.info(gr, "FMP analyst grades backfill: scheduled run complete");
        } catch (err) {
          logger.error({ err }, "FMP analyst grades backfill: scheduled run failed");
        }
        try {
          const es = await backfillEarningsSurprises();
          logger.info(es, "FMP earnings surprises backfill: scheduled run complete");
        } catch (err) {
          logger.error({ err }, "FMP earnings surprises backfill: scheduled run failed");
        }
        try {
          const ae = await backfillAnalystEstimates();
          logger.info(ae, "FMP analyst estimates backfill: scheduled run complete");
        } catch (err) {
          logger.error({ err }, "FMP analyst estimates backfill: scheduled run failed");
        }
        scheduleNextWeekly();
      }, ms);
    }
    scheduleNextWeekly();
  }

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

  function scheduleDailySnapshot() {
    function isTradingDay(d: Date): boolean {
      const iso = nyCalendarYmd(d);
      return isNyTradingSessionDateSync(iso);
    }

    function scheduleNext() {
      const now = new Date();
      const target = new Date(now);
      target.setUTCHours(1, 0, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      while (!isTradingDay(target)) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      const ms = target.getTime() - now.getTime();
      logger.info(
        { targetUTC: target.toISOString(), msUntil: ms },
        "Daily snapshot scheduled (post 8pm ET extended close / 01:00 UTC)",
      );

      setTimeout(() => {
        void runDailySnapshotJob();
        scheduleNext();
      }, ms);
    }

    // Per-date in-flight lock — prevents scheduled cron and boot-catchup
    // from racing the same date (M2 from architect review). Check is
    // cheap & synchronous so the TOCTOU window between alreadyDone() and
    // runFullSnapshot() is closed.
    const snapshotInFlight = new Set<string>();
    async function getDailySnapshotSymbols(): Promise<string[]> {
      const trackedRows = await db
        .select({ symbol: trackedTickersTable.symbol })
        .from(trackedTickersTable)
        .where(eq(trackedTickersTable.active, true));

      // Future scaling note: runFullSnapshot latency grows with this expanded
      // universe. If tracked_tickers gets large, split LC130 and tracked
      // tickers into separate scheduled batches or per-symbol work items.
      return [...new Set([
        ...LIQUID_CORE_SYMBOL_STRINGS,
        ...getTuningUniverseSymbols(),
        ...trackedRows.map((r) => r.symbol.toUpperCase()),
      ])];
    }

    async function runDailySnapshotJob() {
      const token = getBestAccessToken();
      if (!token) {
        logger.warn("Daily snapshot: no Schwab token available — skipping");
        return;
      }
      const symbols = await getDailySnapshotSymbols();
      const dateStr = new Date().toISOString().slice(0, 10);
      if (snapshotInFlight.has(dateStr)) {
        logger.warn({ date: dateStr }, "Daily snapshot: already in-flight for this date — skipping duplicate");
        return;
      }
      snapshotInFlight.add(dateStr);
      logger.info(
        { symbols: symbols.length, date: dateStr },
        "Daily snapshot: starting LC130 + tuning + tracked ticker collection",
      );
      try {
        const result = await runFullSnapshot(symbols, token, dateStr);
        logger.info(
          { ...result, date: dateStr },
          "Daily snapshot: LC130 + tuning + tracked ticker collection complete",
        );
      } catch (err) {
        logger.error(
          { err, date: dateStr },
          "Daily snapshot: LC130 + tuning + tracked ticker collection failed",
        );
      } finally {
        snapshotInFlight.delete(dateStr);
      }
    }

    // ── Boot-time catchup ───────────────────────────────────────────────
    // The 01:00 UTC scheduled job only runs if the server is up at that
    // moment. If the workflow restarts past the firing window (or stays
    // down across multiple trading days), no snapshot ever happens. On
    // boot, look at the most recent successful snapshot date — if today
    // is a trading day past 14:30 UTC (post-market open) AND we don't
    // already have today's snapshot, poll for a Schwab token and run as
    // soon as one appears.
    //
    // RESILIENCE: keep retrying every 30 minutes through the trading day
    // (until the next 01:00 UTC handoff, when the regular cron fires). A single 30-minute
    // window is not resilient enough — token may not appear for hours
    // after a workflow restart, and we silently missed days as a result.
    async function maybeCatchupSnapshot() {
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        const today = new Date(`${todayIso}T00:00:00Z`);
        if (!isTradingDay(today)) {
          logger.info({ todayIso }, "Daily snapshot catchup: not a trading day — skipping");
          return;
        }
        const nowUtcHour = new Date().getUTCHours();
        if (nowUtcHour < 14) {
          logger.info({ nowUtcHour }, "Daily snapshot catchup: pre-market — waiting for scheduled run");
          return;
        }
        const alreadyDone = async (): Promise<boolean> => {
          const r = await db
            .select({ status: snapshotCollectionLogTable.status })
            .from(snapshotCollectionLogTable)
            .where(eq(snapshotCollectionLogTable.date, todayIso))
            .limit(1);
          return r.length > 0 && r[0].status === "completed";
        };
        if (await alreadyDone()) {
          logger.info({ todayIso }, "Daily snapshot catchup: today already complete — skipping");
          return;
        }
        logger.warn({ todayIso }, "Daily snapshot catchup: no completed snapshot for today — will keep polling for Schwab token");

        // Two-phase polling: first 30 min @ 60s (fast token pickup),
        // then 30-min cycle until the next 01:00 UTC daily snapshot run.
        let attempts = 0;
        const fastPollMaxAttempts = 30; // 30 min @ 60s
        const slowPollIntervalMs = 30 * 60 * 1000;
        const stopAfterUtcMs = (() => {
          const t = new Date();
          t.setUTCHours(1, 0, 0, 0);
          if (t.getTime() <= Date.now()) {
            t.setUTCDate(t.getUTCDate() + 1);
          }
          return t.getTime();
        })();

        const tryRun = async () => {
          attempts++;
          // If the regular cron has already passed (or about to fire),
          // stop catchup — the cron will handle it.
          if (Date.now() >= stopAfterUtcMs) {
            logger.info(
              { attempts, todayIso },
              "Daily snapshot catchup: 01:00 UTC handoff reached — handing off to scheduled cron",
            );
            return;
          }
          if (await alreadyDone()) {
            logger.info({ attempts, todayIso }, "Daily snapshot catchup: snapshot completed by another path — exiting");
            return;
          }
          if (getBestAccessToken()) {
            logger.info({ attempts, todayIso }, "Daily snapshot catchup: token available — running");
            await runDailySnapshotJob();
            return;
          }
          const nextDelayMs = attempts < fastPollMaxAttempts ? 60_000 : slowPollIntervalMs;
          if (attempts === fastPollMaxAttempts) {
            logger.warn({ attempts, todayIso }, "Daily snapshot catchup: token still missing after 30min — switching to 30-minute polling");
          }
          setTimeout(() => { void tryRun(); }, nextDelayMs);
        };
        setTimeout(() => { void tryRun(); }, 30_000);
      } catch (err) {
        logger.error({ err }, "Daily snapshot catchup check failed");
      }
    }

    scheduleNext();
    void maybeCatchupSnapshot();
  }

  // ── Polygon S3 flat-files daily sync ────────────────────────────────────
  // Pulls full per-strike options trades from Polygon S3 and writes to
  // polygon_options_history. Runs once a day overnight at 03:30 UTC
  // (~11:30pm ET during daylight time, ~10:30pm ET during standard time) for
  // the prior trading day. Optional boot-time catchup can scan recent trading
  // days for gaps, but is disabled by default because it is heavy enough to
  // starve the live API container during deploys.
  //
  // Env switches:
  //   POLYGON_FLATFILES_DISABLED=1            → schedule never installs (kill switch)
  //   POLYGON_FLATFILES_MAX_CATCHUP_DAYS=N    → cap boot-time catchup window (default 1)
  //   POLYGON_FLATFILES_MAX_S3_REQUESTS=N     → per-day S3 call cap (default 200, hard abort)
  function schedulePolygonFlatFilesSync() {
    if (process.env.POLYGON_FLATFILES_DISABLED === "1") {
      logger.warn("Polygon flat-files sync: POLYGON_FLATFILES_DISABLED=1 — skipping schedule entirely");
      return;
    }
    if (!process.env.POLYGON_S3_ACCESS_KEY || !process.env.POLYGON_S3_SECRET_KEY) {
      logger.warn("Polygon flat-files sync: S3 creds not configured — skipping schedule");
      return;
    }
    // Parse env carefully — a non-numeric value (e.g. "1d") produces NaN from
    // `Number(...)`, which would silently DISABLE both guards (catchup loop
    // `i < NaN` never runs, and `s3Calls > NaN` never trips). Fall back to
    // defaults and warn when the env is set but unparseable.
    function parseIntEnv(name: string, fallback: number): number {
      const raw = process.env[name];
      if (raw === undefined || raw === "") return fallback;
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        logger.warn({ name, raw, fallback }, "Polygon flat-files sync: env unparseable — using fallback");
        return fallback;
      }
      return n;
    }
    const bootCatchupEnabled =
      process.env.POLYGON_FLATFILES_BOOT_CATCHUP_ENABLED === "1" ||
      process.env.POLYGON_FLATFILES_BOOT_CATCHUP_ENABLED === "true";
    const catchupDaysDefault = bootCatchupEnabled ? 3 : 2;
    const catchupDays = Math.max(0, Math.min(30, parseIntEnv("POLYGON_FLATFILES_MAX_CATCHUP_DAYS", catchupDaysDefault)));
    const maxS3Requests = Math.max(1, parseIntEnv("POLYGON_FLATFILES_MAX_S3_REQUESTS", 200));
    const noDataRetryMinutes = Math.max(15, parseIntEnv("POLYGON_FLATFILES_NO_DATA_RETRY_MINUTES", 60));
    const noDataMaxRetries = Math.max(0, Math.min(12, parseIntEnv("POLYGON_FLATFILES_NO_DATA_MAX_RETRIES", 6)));
    logger.info({
      catchupDays,
      maxS3Requests,
      noDataRetryMinutes,
      noDataMaxRetries,
      scheduleUtc: "03:30",
    }, "Polygon flat-files sync: configured");

    // Per-tradeDate in-flight lock — prevents bootCatchup + scheduled cron
    // from racing the same date (H3 from architect review). Both paths
    // early-return if the date is already being processed.
    const flatFilesInFlight = new Set<string>();

    function isTradingDay(d: Date): boolean {
      const iso = nyCalendarYmd(d);
      return isNyTradingSessionDateSync(iso);
    }
    function priorTradingDay(from: Date): Date {
      const d = new Date(from);
      d.setUTCDate(d.getUTCDate() - 1);
      while (!isTradingDay(d)) d.setUTCDate(d.getUTCDate() - 1);
      return d;
    }

    async function runFlatFilesSync(target: Date, attempt = 0) {
      const iso = target.toISOString().slice(0, 10);
      if (flatFilesInFlight.has(iso)) {
        logger.warn({ date: iso }, "Polygon flat-files sync: already in-flight for this date — skipping duplicate");
        return;
      }
      flatFilesInFlight.add(iso);
      try {
        const { syncDate } = await import("./lib/polygonFlatFiles.js");
        const tickers = liquidCoreUnionTuningSymbols();
        let s3CallsObserved = 0;
        logger.info({ date: iso, tickers: tickers.length, maxS3Requests }, "Polygon flat-files sync: starting");
        const result = await syncDate(target, tickers, {
          maxS3Requests,
          onS3Call: () => { s3CallsObserved++; },
        });
        if (result.error?.includes("POLYGON_FLATFILES_MAX_S3_REQUESTS")) {
          logger.error({ ...result, s3CallsObserved, maxS3Requests },
            "Polygon flat-files sync: ABORTED — S3 request budget exceeded");
        } else if (result.error === "No files found" && attempt < noDataMaxRetries) {
          const delayMs = noDataRetryMinutes * 60_000;
          logger.warn({ ...result, attempt, nextAttempt: attempt + 1, delayMs },
            "Polygon flat-files sync: no file yet — retry scheduled");
          const retry = setTimeout(() => {
            void runFlatFilesSync(target, attempt + 1);
          }, delayMs);
          retry.unref?.();
        } else {
          logger.info({ ...result, s3CallsObserved }, "Polygon flat-files sync: complete");
        }
      } catch (err) {
        logger.error({ err, date: iso }, "Polygon flat-files sync: failed");
      } finally {
        flatFilesInFlight.delete(iso);
      }
    }

    function scheduleNext() {
      const now = new Date();
      const target = new Date(now);
      target.setUTCHours(3, 30, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      const ms = target.getTime() - now.getTime();
      logger.info({ targetUTC: target.toISOString(), msUntil: ms }, "Polygon flat-files sync scheduled (03:30 UTC daily)");
      setTimeout(() => {
        const tradeDay = priorTradingDay(new Date());
        void runFlatFilesSync(tradeDay).then(() => scheduleNext());
      }, ms);
    }

    // Boot-time catchup: scan last N trading days (capped by env), sync any not
    // "synced". The default window is intentionally small, but non-zero, so a
    // single early/failed nightly run does not leave yesterday's baseline empty.
    // Keep POLYGON_FLATFILES_MAX_CATCHUP_DAYS=0 available as a kill switch.
    async function bootCatchup() {
      try {
        if (catchupDays === 0) {
          logger.info({
            bootCatchupEnabled,
            envCatchupDays: process.env.POLYGON_FLATFILES_MAX_CATCHUP_DAYS ?? null,
          }, "Polygon flat-files catchup: disabled");
          return;
        }
        const { db: dbRef, inArray, polygonSyncLogTable } = await import("@workspace/db");
        const days: Date[] = [];
        let cursor = priorTradingDay(new Date());
        for (let i = 0; i < catchupDays; i++) {
          days.push(new Date(cursor));
          cursor = priorTradingDay(cursor);
        }
        const isos = days.map(d => d.toISOString().slice(0, 10));
        const existing = await dbRef
          .select({ tradeDate: polygonSyncLogTable.tradeDate, status: polygonSyncLogTable.status })
          .from(polygonSyncLogTable)
          .where(inArray(polygonSyncLogTable.tradeDate, isos));
        const synced = new Set(existing.filter(r => r.status === "synced").map(r => r.tradeDate));
        const missing = days.filter(d => !synced.has(d.toISOString().slice(0, 10)));
        if (missing.length === 0) {
          logger.info({ checked: isos.length }, "Polygon flat-files catchup: all recent days synced");
          return;
        }
        logger.warn({ missing: missing.map(d => d.toISOString().slice(0, 10)) }, "Polygon flat-files catchup: backfilling unsynced recent days");
        for (const d of missing) {
          await runFlatFilesSync(d);
        }
      } catch (err) {
        logger.error({ err }, "Polygon flat-files catchup: failed");
      }
    }

    scheduleNext();
    setTimeout(() => { void bootCatchup(); }, 60_000);
  }

  /** Item 24: 90d options_flow_raw_trades retention + Schwab chart-bar 30d prune + rebaseline volume_vs (04:45 UTC). */
  function scheduleNightlyFlowRawMaintenance() {
    if (process.env.DISABLE_FLOW_RAW_MAINTENANCE === "1" || process.env.DISABLE_FLOW_RAW_MAINTENANCE === "true") {
      logger.warn("Flow raw maintenance: DISABLE_FLOW_RAW_MAINTENANCE=1 — skipping schedule");
      return;
    }
    function scheduleNext() {
      const now = new Date();
      const target = new Date(now);
      target.setUTCHours(4, 45, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      const ms = target.getTime() - now.getTime();
      logger.info({ targetUTC: target.toISOString(), msUntil: ms }, "Flow raw + Schwab chart-bar maintenance scheduled (04:45 UTC daily)");
      setTimeout(() => {
        void import("./lib/flowRawTradesReclassify.js")
          .then((m) => m.runNightlyFlowRawMaintenance())
          .catch((err) => logger.error({ err }, "Nightly flow raw maintenance failed"))
          .finally(() => scheduleNext());
      }, ms);
    }
    scheduleNext();
  }

  // Bind to "::" (IPv6 wildcard) so other services on Railway's private
  // network can reach us. Railway's internal DNS resolves <service>.railway.internal
  // to an IPv6 address (`fd12:...`), and a process listening only on
  // 0.0.0.0 (IPv4) will silently miss those incoming connections — the
  // exact symptom we observed: nginx -> "upstream timed out" against the
  // backend's IPv6 address even though the backend logged "Server listening
  // host: 0.0.0.0". Listening on "::" with the OS dual-stack default also
  // accepts IPv4 traffic transparently, so this works for both private and
  // public ingress. See https://docs.railway.com/private-networking.
  const host = process.env["HOST"] ?? "::";
  const server = app.listen(port, host, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ host, port }, "Server listening");
  });

  // Discovery scan can exceed 120s (IOScore, earnings, flow highlights, large JSON).
  // Keep above proxy / client expectations (see alpha-terminal nginx template).
  server.timeout = 180_000;
  server.keepAliveTimeout = 180_000;
  server.headersTimeout = 185_000;

  initWsServer(server);

  const SCHWAB_FUTURES_SYMS_EARLY = [
    "/ES", "/NQ", "/YM", "/RTY",
    "/GC", "/CL", "/BZ", "/HG", "/SI", "/NG", "/RB", "/PL",
    "/ZB", "/ZN", "/ZF", "/ZT", "/ZQ",
    "/6E", "/6J", "/6B", "/6A", "/6C",
    "/BTC", "/ETH",
    "/UB", "/ZC", "/ZS", "/ZW",
    "/MES", "/MNQ", "/M2K",
  ];
  const SCHWAB_EQUITY_SYMS_EARLY = [
    "SPY", "QQQ", "IWM",
    "$VIX", "$VVIX", "$VIX1D", "$VIX9D", "$VIX3M",
    "$SPX", "$NDX", "$RUT", "$DJI", "$SOX",
    "$TNX", "$TYX", "$IRX",
    "$VXN", "$RVX", "$OVX", "$GVZ",
    "$TICK", "$TICKI",
    "HYG", "LQD", "IEF", "TLT",
  ];

  setImmediate(() => {
    void (async () => {
      await loadAiLabConfigFromDb();
      await initTokenStore();
      startExitMonitor();
      startTelemetryCleanup();
      startTelemetryRetentionJob();
      initDeltaEngine();

      // Recover any snapshot rows orphaned by a prior crash/SIGKILL. Without
      // this a stale 'running' row blocks future runs and silently re-opens
      // IV history gaps. See dailySnapshot.sweepStaleSnapshots for details.
      sweepStaleSnapshots().catch((e) => {
        logger.warn({ err: e }, "sweepStaleSnapshots: startup sweep failed");
      });

      // Recover any on-demand IVR backfill jobs left in 'running' state by a
      // prior server kill or Railway redeploy. Without this, stuck jobs
      // permanently return 'populating' for the affected ticker instead of
      // allowing a fresh backfill to be triggered.
      recoverOrphanedIvrJobs().catch((e) => {
        logger.warn({ err: e }, "recoverOrphanedIvrJobs: startup sweep failed");
      });

      scheduleDailyScreenRefresh();
      scheduleDailySnapshot();
      scheduleCanonicalIvAccumulator();
      scheduleFmpWeeklyBackfills();
      schedulePolygonFlatFilesSync();
      scheduleNightlyFlowRawMaintenance();

      await migrateAiLabSeedData();
      initAiLabOrchestrator();
      startUniverseRebuildSchedule();
      triggerLiquidCoreBackfill();
      void triggerFlowBootstrap();

      // Start the Schwab streamer HERE — after initTokenStore() has loaded
      // tokens from the DB. The check lower in boot() runs before this
      // deferred block resolves, so hasValidTokens() is always false there.
      if (process.env.DISABLE_SCHWAB_STREAMER === "1" || process.env.DISABLE_SCHWAB_STREAMER === "true") {
        logger.warn("Schwab streamer DISABLED via DISABLE_SCHWAB_STREAMER env flag");
      } else if (hasValidTokens("trader")) {
        logger.info("Deferred init: Schwab tokens available — starting streamer");
        startSchwabStreamer().then(() => {
          addFuturesSymbols([...SCHWAB_FUTURES_SYMS_EARLY]);
          if (SCHWAB_EQUITY_SYMS_EARLY.length > 0) addSchwabSymbols(SCHWAB_EQUITY_SYMS_EARLY);
          registerPersistentSchwabTuningStreaming();
          initSyntheticDxy();
        }).catch((err) => logger.warn({ err }, "Schwab streamer start failed (deferred init)"));
      } else {
        logger.info("Deferred init: Schwab tokens not available — streamer will start on token refresh or /stream/start");
      }
    })().catch((err) => {
      logger.error({ err }, "Boot background initialization failed");
    });
  });

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
    try {
      await runLiquidCoreEquityBackfillOnce();
    } catch (err) {
      backfillTriggered = false;
      logger.warn({ err }, "Grouped daily equity update failed");
    }
  }

  // ── Boot-time Polygon flow gap repair (per-symbol options_flow_per_strike coverage)
  let flowBootstrapTriggered = false;
  async function triggerFlowBootstrap() {
    if (flowBootstrapTriggered) return;
    flowBootstrapTriggered = true;
    try {
      await runFlowBootstrapGapRepairOnce();
    } catch (err) {
      flowBootstrapTriggered = false;
      logger.error({ err }, "Flow bootstrap: failed");
    }
  }

  // When a token refresh happens (e.g. after OAuth flow or DB load), add
  // symbols and ensure the streamer is running. The primary startup path is
  // the deferred setImmediate block above, but this covers two edge cases:
  //   1. initTokenStore fires the callback before the deferred block runs
  //   2. A mid-session OAuth login brings new tokens while the server is up
  setTokenRefreshCallback((kind, _accessToken) => {
    if (kind === "trader" || kind === "market") {
      if (
        process.env.DISABLE_SCHWAB_STREAMER !== "1" &&
        process.env.DISABLE_SCHWAB_STREAMER !== "true" &&
        !isSchwabConnected()
      ) {
        logger.info({ kind }, "Token refresh: starting Schwab streamer (was not connected)");
        startSchwabStreamer().then(() => {
          addFuturesSymbols([...SCHWAB_FUTURES_SYMS, ...SCHWAB_FUTURES_INDEX_SYMS]);
          if (SCHWAB_EQUITY_SYMS.length > 0) addSchwabSymbols(SCHWAB_EQUITY_SYMS);
          registerPersistentSchwabTuningStreaming();
          initSyntheticDxy();
        }).catch((err) => logger.warn({ err }, "Schwab streamer start failed (token refresh callback)"));
      } else {
        addFuturesSymbols([...SCHWAB_FUTURES_SYMS, ...SCHWAB_FUTURES_INDEX_SYMS]);
        if (SCHWAB_EQUITY_SYMS.length > 0) addSchwabSymbols(SCHWAB_EQUITY_SYMS);
        registerPersistentSchwabTuningStreaming();
        schwabTokenRefreshed();
        initSyntheticDxy();
      }
    }
  });

  registerQuoteCacheInjector(injectExternalQuote);
  registerIBBroadcast(broadcastToClients);

  startPolygonPCRatioPoller();

  // Part 2 — start the persistent options watcher. Env-gated by
  // POLYGON_OPTIONS_WS_ENABLED; when off this is a no-op. Initial
  // watchlist is empty — the deterministic scanner populates HOT/WARM
  // tiers from its top-ranked candidates after each scan.
  void startOptionsWatcher().catch((err) =>
    logger.warn({ err }, "options watcher start failed (will not retry)"),
  );

  // Phase 1 sweep/block persistence — start the batched DB writer that
  // drains the watcher's classified-event queue, plus the periodic
  // rollup that aggregates raw_trades → exec_per_strike for the scanner.
  // Both are no-ops if the watcher isn't streaming events.
  try {
    const { startFlowPersistence } = await import("./lib/optionsFlowPersistence.js");
    const { startFlowRollup } = await import("./lib/optionsFlowRollup.js");
    startFlowPersistence();
    startFlowRollup();
  } catch (err) {
    logger.warn({ err }, "flow persistence/rollup start failed");
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
