import { Router, type IRouter } from "express";
import { analyzeTickerV2, type StrategistV2Result } from "../lib/strategistV2.js";
import { getSettings, updateSetting, resetAllSettings, getDefaults, getSettingMeta } from "../lib/strategistSettings.js";
import { getCachedRegime, buildFallbackRegime } from "../lib/regimePostProcessor.js";
import {
  runTradeValidation,
  type ValidationInput,
  type ValidationTicket,
  type ValidationVerdictPayload,
} from "../lib/strategistValidate.js";
import { db, strategistTelemetryTable, scannerTelemetryTable, strategistHistoryTable } from "@workspace/db";
import { desc, eq, sql, lte, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/regime", (_req, res) => {
  const regime = getCachedRegime() ?? buildFallbackRegime();
  res.json(regime);
});

// Structured debate transcript turn. In Solo mode the transcript stays empty
// and the UI falls back to the existing token feed; in Debate mode each AI
// turn is one entry whose `text` grows as tokens stream in.
export type TranscriptTurn = {
  id: string;
  round: 1 | 2 | 3 | "synthesis";
  role: "A" | "B" | "synthesis" | "system";
  phase: "propose" | "critique" | "final" | "synthesis" | "info";
  model: string;
  label: string;
  text: string;
  ts: number;
  done: boolean;
};

// In-memory live thinking buffer per jobId (for streaming-style polling).
// Used for BOTH ticker analysis (kind: "analyze") and trade validation
// (kind: "validation"). The frontend poller discriminates on `kind`.
export type ValidationMeta = {
  ticker: string;
  mode: "opening" | "closing";
  ticket: ValidationTicket;
  thesis?: string;
  rollingShort?: boolean;
};

type ThinkingEntry = {
  jobId: string;
  kind: "analyze" | "validation";
  ticker: string;
  status: string;
  tokens: string[];
  transcript: TranscriptTurn[];
  done: boolean;
  result?: StrategistV2Result;
  validationResult?: ValidationVerdictPayload;
  validationMeta?: ValidationMeta;
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

async function persistHistory(
  jobId: string,
  ticker: string,
  result: StrategistV2Result,
  debateTranscript?: TranscriptTurn[],
) {
  try {
    // Stash the debate transcript inside cardJson so it travels with the
    // saved trade card and can be re-rendered from history without needing
    // a DB migration. cardJson is jsonb; downstream typings treat unknown
    // fields as optional.
    const cardJson =
      debateTranscript && debateTranscript.length > 0
        ? ({ ...result, debateTranscript } as unknown as object)
        : (result as unknown as object);
    await db
      .insert(strategistHistoryTable)
      .values({ jobId, ticker, cardJson, cleared: false })
      .onConflictDoNothing({ target: strategistHistoryTable.jobId });
  } catch (persistErr) {
    logger.warn({ persistErr, jobId, ticker }, "StrategistV2: failed to persist history (non-fatal)");
  }
}

router.post("/analyze", async (req, res): Promise<void> => {
  try {
    const { ticker, jobId, flowContext } = req.body as { ticker?: string; jobId?: string; flowContext?: string };
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
        kind: "analyze",
        ticker: upperTicker,
        status: "Starting analysis…",
        tokens: [],
        transcript: [],
        done: false,
        startedAt: Date.now(),
      };
      strategistThinkingBuffer.set(jobId, entry);

      // Fire-and-forget background analysis
      void (async () => {
        try {
          const result = await analyzeTickerV2(upperTicker, {
            flowContext: typeof flowContext === "string" && flowContext.length > 0 ? flowContext.slice(0, 8000) : undefined,
            onStatus: (s) => {
              entry.status = s;
            },
            onToken: (t) => {
              entry.tokens.push(t);
              // Cap memory: keep last ~6000 tokens (~24KB+)
              if (entry.tokens.length > 6000) entry.tokens.splice(0, entry.tokens.length - 6000);
            },
            onTurnStart: (turn) => {
              entry.transcript.push({
                id: turn.id,
                round: turn.round,
                role: turn.role,
                phase: turn.phase,
                model: turn.model,
                label: turn.label,
                text: "",
                ts: turn.startedAt,
                done: false,
              });
              // Defensive cap on transcript size (3 rounds * 2 + synthesis = 7 max).
              if (entry.transcript.length > 32) entry.transcript.splice(0, entry.transcript.length - 32);
            },
            onTurnDelta: (turnId, delta) => {
              const t = entry.transcript.find(x => x.id === turnId);
              if (t) t.text += delta;
            },
            onTurnDone: (turnId, finalText) => {
              const t = entry.transcript.find(x => x.id === turnId);
              if (t) {
                t.text = finalText;
                t.done = true;
              }
            },
          });
          entry.result = result;
          entry.status = "Done";
          entry.done = true;
          entry.finishedAt = Date.now();
          await persistHistory(jobId, upperTicker, result, entry.transcript);
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
    const result = await analyzeTickerV2(upperTicker, {
      flowContext: typeof flowContext === "string" && flowContext.length > 0 ? flowContext.slice(0, 8000) : undefined,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "StrategistV2: analyze failed");
    res.status(500).json({ error: "Analysis failed" });
  }
});

// ──────────────────────────────────────────────────────────────────────
// POST /validate-trade
// Body: { ticket: ValidationTicket, jobId: string, thesis?: string,
//         rollingShort?: boolean }
// Reuses the strategistThinkingBuffer with kind: "validation" so the
// existing /thinking/:jobId poller works unchanged.
// ──────────────────────────────────────────────────────────────────────
router.post("/validate-trade", (req, res): void => {
  try {
    const { ticket, jobId, thesis, rollingShort } = req.body as {
      ticket?: ValidationTicket;
      jobId?: string;
      thesis?: string;
      rollingShort?: boolean;
    };
    if (!jobId || typeof jobId !== "string") {
      res.status(400).json({ error: "jobId is required" });
      return;
    }
    if (!ticket || typeof ticket !== "object" || !ticket.ticker) {
      res.status(400).json({ error: "ticket with ticker is required" });
      return;
    }
    const upperTicker = String(ticket.ticker).toUpperCase();

    pruneThinkingBuffer();
    const existing = strategistThinkingBuffer.get(jobId);
    if (existing) {
      res.json({ jobId, accepted: true, alreadyRunning: !existing.done });
      return;
    }

    const meta: ValidationMeta = {
      ticker: upperTicker,
      mode: ticket.mode,
      ticket: { ...ticket, ticker: upperTicker },
      thesis: typeof thesis === "string" ? thesis.slice(0, 4000) : undefined,
      rollingShort: rollingShort === true,
    };

    const entry: ThinkingEntry = {
      jobId,
      kind: "validation",
      ticker: upperTicker,
      status: "Starting trade validation…",
      tokens: [],
      transcript: [],
      done: false,
      validationMeta: meta,
      startedAt: Date.now(),
    };
    strategistThinkingBuffer.set(jobId, entry);

    const input: ValidationInput = {
      ticket: meta.ticket,
      thesis: meta.thesis,
      rollingShort: meta.rollingShort,
    };

    void (async () => {
      try {
        const result = await runTradeValidation(input, {
          onStatus: (s) => { entry.status = s; },
          onTurnStart: (turn) => {
            entry.transcript.push({
              id: turn.id, round: turn.round, role: turn.role, phase: turn.phase,
              model: turn.model, label: turn.label, text: "", ts: turn.startedAt, done: false,
            });
            if (entry.transcript.length > 32) entry.transcript.splice(0, entry.transcript.length - 32);
          },
          onTurnDelta: (turnId, delta) => {
            const t = entry.transcript.find(x => x.id === turnId);
            if (t) t.text += delta;
          },
          onTurnDone: (turnId, finalText) => {
            const t = entry.transcript.find(x => x.id === turnId);
            if (t) { t.text = finalText; t.done = true; }
          },
        });
        entry.validationResult = result;
        entry.status = `Verdict: ${result.verdict}`;
        entry.done = true;
        entry.finishedAt = Date.now();

        // Persist to history with a discriminator inside cardJson so the
        // existing history table works without a migration.
        try {
          const cardJson = {
            kind: "validation",
            validation: result,
            ticket: meta.ticket,
            thesis: meta.thesis ?? null,
            rollingShort: meta.rollingShort ?? false,
            debateTranscript: entry.transcript,
          } as unknown as object;
          await db
            .insert(strategistHistoryTable)
            .values({ jobId, ticker: upperTicker, cardJson, cleared: false })
            .onConflictDoNothing({ target: strategistHistoryTable.jobId });
        } catch (persistErr) {
          logger.warn({ persistErr, jobId }, "TradeValidation: failed to persist history (non-fatal)");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        entry.error = message;
        entry.status = `Failed: ${message}`;
        entry.done = true;
        entry.finishedAt = Date.now();
        logger.error({ err, jobId, ticker: upperTicker }, "TradeValidation: background validate failed");
      }
    })();

    res.json({ jobId, accepted: true, alreadyRunning: false });
  } catch (err) {
    logger.error({ err }, "TradeValidation: validate-trade route failed");
    res.status(500).json({ error: "Validation failed to start" });
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
  // For validation jobs, the canonical "result" is the validation verdict
  // payload (so the existing poller's `completeStrategistJob(jobId, result)`
  // call stores the right thing). `kind` and `validationMeta` are extra
  // discriminator fields the frontend uses to render the validation card.
  const result = entry.kind === "validation"
    ? (entry.validationResult ?? null)
    : (entry.result ?? null);
  res.json({
    jobId: entry.jobId,
    kind: entry.kind ?? "analyze",
    ticker: entry.ticker,
    status: entry.status,
    tokens,
    nextSince: totalTokens,
    transcript: entry.transcript,
    done: entry.done,
    result,
    validationMeta: entry.validationMeta ?? null,
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
