import { Router, type IRouter } from "express";
import { getSettings, updateSetting, resetAllSettings, getDefaults, getSettingMeta } from "../lib/strategistSettings.js";
import { getCachedRegime, buildFallbackRegime } from "../lib/regimePostProcessor.js";
import { db, strategistTelemetryTable, scannerTelemetryTable, strategistHistoryTable } from "@workspace/db";
import { getScannerStrategistCorrelation } from "../lib/scannerCorrelation.js";
import { desc, eq, lte } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { trimStrategistTelemetryRowForListResponse } from "../lib/strategistTelemetryListResponse.js";
import {
  primeStrategistTelemetryReadSchema,
  strategistTelemetryFlattenErrorMessage,
  strategistTelemetryPostgresErrorCode,
  sanitizeStrategistTelemetryClientDetail,
} from "../lib/ensureStrategistTelemetryAuditColumns.js";
import {
  selectStrategistTelemetryRows,
  selectStrategistTelemetryRowById,
  selectStrategistTelemetryRowByRequestId,
} from "../lib/strategistTelemetryFlexibleSelect.js";
import { getIvrBackfillJob, getLatestIvrBackfillJobForSymbol } from "../lib/onDemandIvrBackfill.js";
import { stripHistoryCardJsonForClient } from "../lib/strategistClientSanitize.js";

const router: IRouter = Router();

router.get("/regime", (_req, res) => {
  const regime = getCachedRegime() ?? buildFallbackRegime();
  res.json(regime);
});

router.get("/ivr-backfill/symbol/:symbol", async (req, res) => {
  try {
    const job = await getLatestIvrBackfillJobForSymbol(req.params.symbol);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json({
      id: job.id,
      symbol: job.symbol,
      status: job.status,
      source: job.source,
      daysLoaded: job.daysLoaded,
      daysRequested: job.daysRequested,
      equityRowsWritten: job.equityRowsWritten,
      ivRowsWritten: job.ivRowsWritten,
      ivrRowsWritten: job.ivrRowsWritten,
      errorMsg: job.errorMsg,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    logger.error({ err }, "StrategistV2: latest IVR backfill job fetch failed");
    res.status(500).json({ error: "Failed to fetch IVR backfill job" });
  }
});

router.get("/ivr-backfill/:jobId", async (req, res) => {
  try {
    const job = await getIvrBackfillJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json({
      id: job.id,
      symbol: job.symbol,
      status: job.status,
      source: job.source,
      daysLoaded: job.daysLoaded,
      daysRequested: job.daysRequested,
      equityRowsWritten: job.equityRowsWritten,
      ivRowsWritten: job.ivRowsWritten,
      ivrRowsWritten: job.ivrRowsWritten,
      errorMsg: job.errorMsg,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    logger.error({ err }, "StrategistV2: IVR backfill job fetch failed");
    res.status(500).json({ error: "Failed to fetch IVR backfill job" });
  }
});


router.get("/history", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(strategistHistoryTable)
      .where(eq(strategistHistoryTable.cleared, false))
      .orderBy(desc(strategistHistoryTable.createdAt))
      .limit(100);
    res.json(
      rows.map((row) => ({
        ...row,
        cardJson: stripHistoryCardJsonForClient(row.cardJson),
      })),
    );
  } catch (err) {
    logger.error({ err }, "StrategistV2: history fetch failed");
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.patch("/history/:id/clear", async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    await db
      .update(strategistHistoryTable)
      .set({ cleared: true, clearedAt: new Date() })
      .where(eq(strategistHistoryTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "StrategistV2: history clear failed");
    res.status(500).json({ error: "Failed to clear history row" });
  }
});

router.delete("/history/all", async (_req, res) => {
  try {
    const result = await db
      .update(strategistHistoryTable)
      .set({ cleared: true, clearedAt: new Date() })
      .where(eq(strategistHistoryTable.cleared, false));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "StrategistV2: history clear-all failed");
    res.status(500).json({ error: "Failed to clear history" });
  }
});

router.get("/settings", async (_req, res) => {
  const t0 = performance.now();
  try {
    const current = await getSettings();
    const meta = getSettingMeta();
    const defaults = getDefaults();
    const ms = Math.round(performance.now() - t0);
    if (ms > 150) {
      logger.info({ ms, keysReturned: Object.keys(current).length }, "StrategistV2: GET /settings slow");
    }
    res.json({ current, meta, defaults });
  } catch (err) {
    logger.error({ err }, "StrategistV2: settings fetch failed");
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res): Promise<void> => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      res.status(400).json({ error: "key and value required" });
      return;
    }
    await updateSetting(key, Number(value));
    const updated = await getSettings();
    res.json({ success: true, current: updated });
  } catch (err: any) {
    logger.error({ err }, "StrategistV2: setting update failed");
    res.status(400).json({ error: err.message || "Update failed" });
  }
});

router.post("/settings/reset", async (_req, res) => {
  try {
    await resetAllSettings();
    const current = await getSettings();
    res.json({ success: true, current });
  } catch (err) {
    logger.error({ err }, "StrategistV2: settings reset failed");
    res.status(500).json({ error: "Reset failed" });
  }
});

function strategistTelemetryFetchErrorJson(err: unknown, mode: "list" | "row"): Record<string, unknown> {
  const flat = strategistTelemetryFlattenErrorMessage(err);
  const code = strategistTelemetryPostgresErrorCode(err);
  const hint =
    code === "42703" ||
    code === "42704" ||
    /column .*does not exist/i.test(flat)
      ? "strategist_telemetry schema does not match this API build. Deploy the latest server or run lib/db migrations against Postgres."
      : undefined;
  const detail = sanitizeStrategistTelemetryClientDetail(flat);
  return {
    error: mode === "list" ? "Failed to fetch telemetry" : "Failed to fetch telemetry row",
    ...(hint ? { hint } : {}),
    ...(detail ? { detail } : {}),
    ...(code ? { postgresCode: code } : {}),
  };
}

router.get("/telemetry/strategist/row/:id", async (req, res) => {
  try {
    await primeStrategistTelemetryReadSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const row = await selectStrategistTelemetryRowById(id);
    if (!row) {
      res.status(404).json({ error: "Telemetry row not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    logger.error({ err, pgCode: strategistTelemetryPostgresErrorCode(err) }, "StrategistV2: telemetry row lookup failed");
    res.status(500).json(strategistTelemetryFetchErrorJson(err, "row"));
  }
});

router.get("/telemetry/strategist/request/:requestId", async (req, res) => {
  try {
    await primeStrategistTelemetryReadSchema();
    const requestId = String(req.params.requestId ?? "").trim();
    if (!requestId) {
      res.status(400).json({ error: "requestId required" });
      return;
    }
    const row = await selectStrategistTelemetryRowByRequestId(requestId);
    if (!row) {
      res.status(404).json({ error: "Telemetry row not found for requestId" });
      return;
    }
    res.json(row);
  } catch (err) {
    logger.error({ err, pgCode: strategistTelemetryPostgresErrorCode(err) }, "StrategistV2: telemetry request lookup failed");
    res.status(500).json(strategistTelemetryFetchErrorJson(err, "row"));
  }
});

router.get("/telemetry/strategist", async (req, res) => {
  try {
    await primeStrategistTelemetryReadSchema();
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const ticker = req.query.ticker as string | undefined;

    const rows = await selectStrategistTelemetryRows({
      limit,
      tickerUpper: ticker ? ticker.toUpperCase() : undefined,
    });

    res.json(rows.map((r) => trimStrategistTelemetryRowForListResponse(r as Record<string, unknown>)));
  } catch (err) {
    logger.error({ err, pgCode: strategistTelemetryPostgresErrorCode(err) }, "StrategistV2: telemetry fetch failed");
    res.status(500).json(strategistTelemetryFetchErrorJson(err, "list"));
  }
});

router.get("/telemetry/scanner", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const rows = await db.select().from(scannerTelemetryTable)
      .orderBy(desc(scannerTelemetryTable.timestamp)).limit(limit);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "StrategistV2: scanner telemetry fetch failed");
    res.status(500).json({ error: "Failed to fetch scanner telemetry" });
  }
});

router.get("/scanner-correlation", async (req, res) => {
  try {
    const lookbackDays = Math.min(Math.max(Number(req.query.lookbackDays) || 14, 1), 365);
    const src = req.query.scannerSource as string | undefined;
    const scannerSource =
      src === "discovery" || src === "momentum" || src === "unusual_flow" || src === "unified"
        ? src
        : undefined;
    const summary = await getScannerStrategistCorrelation({ lookbackDays, scannerSource });
    res.json({ lookbackDays, scannerSource: scannerSource ?? null, ...summary });
  } catch (err) {
    logger.error({ err }, "StrategistV2: scanner correlation failed");
    res.status(500).json({ error: "Failed to compute scanner correlation" });
  }
});

router.delete("/telemetry/cleanup", async (_req, res) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    await db.delete(strategistTelemetryTable).where(lte(strategistTelemetryTable.timestamp, cutoff));
    await db.delete(scannerTelemetryTable).where(lte(scannerTelemetryTable.timestamp, cutoff));

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "StrategistV2: telemetry cleanup failed");
    res.status(500).json({ error: "Cleanup failed" });
  }
});

export default router;
