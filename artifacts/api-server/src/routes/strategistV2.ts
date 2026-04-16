import { Router, type IRouter } from "express";
import { analyzeTickerV2 } from "../lib/strategistV2.js";
import { getSettings, updateSetting, resetAllSettings, getDefaults, getSettingMeta } from "../lib/strategistSettings.js";
import { getCachedRegime, buildFallbackRegime } from "../lib/regimePostProcessor.js";
import { db, strategistTelemetryTable, scannerTelemetryTable, strategistHistoryTable } from "@workspace/db";
import { desc, eq, sql, lte, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/regime", (_req, res) => {
  const regime = getCachedRegime() ?? buildFallbackRegime();
  res.json(regime);
});

router.post("/analyze", async (req, res): Promise<void> => {
  try {
    const { ticker, jobId } = req.body;
    if (!ticker || typeof ticker !== "string") {
      res.status(400).json({ error: "ticker is required" });
      return;
    }
    const upperTicker = ticker.toUpperCase();
    const result = await analyzeTickerV2(upperTicker);

    // Persist to history if a jobId was supplied (idempotent on jobId)
    if (jobId && typeof jobId === "string") {
      try {
        await db
          .insert(strategistHistoryTable)
          .values({
            jobId,
            ticker: upperTicker,
            cardJson: result as unknown as object,
            cleared: false,
          })
          .onConflictDoNothing({ target: strategistHistoryTable.jobId });
      } catch (persistErr) {
        logger.warn({ persistErr, jobId, ticker: upperTicker }, "StrategistV2: failed to persist history (non-fatal)");
      }
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, "StrategistV2: analyze failed");
    res.status(500).json({ error: "Analysis failed" });
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
    res.json(rows);
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
  try {
    const current = await getSettings();
    const meta = getSettingMeta();
    const defaults = getDefaults();
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

router.get("/telemetry/strategist", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const ticker = req.query.ticker as string | undefined;

    const rows = ticker
      ? await db.select().from(strategistTelemetryTable)
          .where(eq(strategistTelemetryTable.ticker, ticker.toUpperCase()))
          .orderBy(desc(strategistTelemetryTable.timestamp)).limit(limit)
      : await db.select().from(strategistTelemetryTable)
          .orderBy(desc(strategistTelemetryTable.timestamp)).limit(limit);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, "StrategistV2: telemetry fetch failed");
    res.status(500).json({ error: "Failed to fetch telemetry" });
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
