import { Router, type IRouter } from "express";
import { analyzeTickerV2, type StrategistV2Result } from "../lib/strategistV2.js";
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

// In-memory live thinking buffer per jobId (for streaming-style polling)
type ThinkingEntry = {
  jobId: string;
  ticker: string;
  status: string;
  tokens: string[];
  done: boolean;
  result?: StrategistV2Result;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};
const strategistThinkingBuffer = new Map<string, ThinkingEntry>();
const THINKING_TTL_MS = 10 * 60 * 1000;
function pruneThinkingBuffer() {
  const now = Date.now();
  for (const [k, v] of strategistThinkingBuffer.entries()) {
    if (v.done && v.finishedAt && now - v.finishedAt > THINKING_TTL_MS) {
      strategistThinkingBuffer.delete(k);
    } else if (!v.done && now - v.startedAt > 5 * THINKING_TTL_MS) {
      // safety: drop stuck entries after 50 minutes
      strategistThinkingBuffer.delete(k);
    }
  }
}

async function persistHistory(jobId: string, ticker: string, result: StrategistV2Result) {
  try {
    await db
      .insert(strategistHistoryTable)
      .values({ jobId, ticker, cardJson: result as unknown as object, cleared: false })
      .onConflictDoNothing({ target: strategistHistoryTable.jobId });
  } catch (persistErr) {
    logger.warn({ persistErr, jobId, ticker }, "StrategistV2: failed to persist history (non-fatal)");
  }
}

router.post("/analyze", async (req, res): Promise<void> => {
  try {
    const { ticker, jobId } = req.body;
    if (!ticker || typeof ticker !== "string") {
      res.status(400).json({ error: "ticker is required" });
      return;
    }
    const upperTicker = ticker.toUpperCase();

    // If jobId provided, run analyze in background with progress streaming
    // and respond immediately with {jobId} so the UI can poll.
    if (jobId && typeof jobId === "string") {
      pruneThinkingBuffer();
      // Idempotency: if a buffer already exists for this jobId, return it.
      const existing = strategistThinkingBuffer.get(jobId);
      if (existing) {
        res.json({ jobId, accepted: true, alreadyRunning: !existing.done });
        return;
      }
      const entry: ThinkingEntry = {
        jobId,
        ticker: upperTicker,
        status: "Starting analysis…",
        tokens: [],
        done: false,
        startedAt: Date.now(),
      };
      strategistThinkingBuffer.set(jobId, entry);

      // Fire-and-forget background analysis
      void (async () => {
        try {
          const result = await analyzeTickerV2(upperTicker, {
            onStatus: (s) => {
              entry.status = s;
            },
            onToken: (t) => {
              entry.tokens.push(t);
              // Cap memory: keep last ~6000 tokens (~24KB+)
              if (entry.tokens.length > 6000) entry.tokens.splice(0, entry.tokens.length - 6000);
            },
          });
          entry.result = result;
          entry.status = "Done";
          entry.done = true;
          entry.finishedAt = Date.now();
          await persistHistory(jobId, upperTicker, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          entry.error = message;
          entry.status = `Failed: ${message}`;
          entry.done = true;
          entry.finishedAt = Date.now();
          logger.error({ err, jobId, ticker: upperTicker }, "StrategistV2: background analyze failed");
        }
      })();

      res.json({ jobId, accepted: true, alreadyRunning: false });
      return;
    }

    // Legacy synchronous path (no jobId): block and return result
    const result = await analyzeTickerV2(upperTicker);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "StrategistV2: analyze failed");
    res.status(500).json({ error: "Analysis failed" });
  }
});

router.get("/thinking/:jobId", (req, res): void => {
  pruneThinkingBuffer();
  const entry = strategistThinkingBuffer.get(req.params.jobId);
  if (!entry) {
    res.status(404).json({ error: "job not found" });
    return;
  }
  // Incremental delivery: client passes ?since=<index> to receive only new tokens.
  const sinceRaw = req.query.since;
  const since = typeof sinceRaw === "string" ? Math.max(0, parseInt(sinceRaw, 10) || 0) : 0;
  const totalTokens = entry.tokens.length;
  const tokens = since < totalTokens ? entry.tokens.slice(since) : [];
  res.json({
    jobId: entry.jobId,
    ticker: entry.ticker,
    status: entry.status,
    tokens,
    nextSince: totalTokens,
    done: entry.done,
    result: entry.result ?? null,
    error: entry.error ?? null,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt ?? null,
  });
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
