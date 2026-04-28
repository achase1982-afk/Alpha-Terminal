import { Router, type IRouter } from "express";
import { db, aiLabIdeasTable, aiLabIdeaOutcomesTable, aiLabWatchlistTable, aiLabDeliberationsTable, scannerWatchlistsTable } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { emitTelemetry, createTelemetryBatch } from "../lib/telemetryStore.js";
import {
  getUniverseAnomalies,
  getTickerSnapshot,
  getRegimeState,
  getPatternPerformance,
  getScannerAlignment,
} from "../lib/aiLabService.js";
import { validateAiLabIdea, type TradeIdeaCandidate, type MarketDataSnapshot } from "../lib/aiLabValidator.js";
import {
  overnightDigest,
  preMarketPlan,
  postOpenCheck,
  midMorningScan,
  middayRotationCheck,
  powerHourPrep,
  postMarketReflection,
  priceShockTrigger,
  blockFlowTrigger,
  scannerScoreJumpTrigger,
} from "../lib/aiLabOrchestrator.js";
import {
  getAiLabStrategistConfig,
  getAiLabFullConfig,
  getAiLabConfigDefaults,
  updateAiLabStrategistConfig,
  resetAiLabStrategistConfig,
  SETTINGS_META,
  PROMPT_ROLES,
  type PromptRole,
  getAllActivePrompts,
  getPromptHistory,
  savePrompt,
  resetPromptToDefault,
  restorePrompt,
} from "../lib/aiLabConfig.js";
import {
  DEFAULT_ANALYST_SYSTEM_PROMPT,
  DEFAULT_ANALYST_REBUTTAL_SYSTEM_PROMPT,
  DEFAULT_UNIVERSE_SCREEN_SYSTEM_PROMPT,
} from "../lib/aiLabAnalystClient.js";
import {
  DEFAULT_SKEPTIC_SYSTEM_PROMPT,
  DEFAULT_SKEPTIC_REEVAL_SYSTEM_PROMPT,
} from "../lib/aiLabSkepticClient.js";
import { refreshOrchestratorConfig } from "../lib/aiLabOrchestrator.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";
import { getAuth } from "@clerk/express";

const DEV_BYPASS = process.env.VITE_DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user_local";

function getUserId(req: any): string {
  if (DEV_BYPASS) return DEV_USER_ID;
  try {
    const auth = getAuth(req);
    return auth?.userId ?? DEV_USER_ID;
  } catch {
    return DEV_USER_ID;
  }
}

const router: IRouter = Router();

const VALID_DIRECTIONS = ["LONG", "SHORT"] as const;
const VALID_INSTRUMENT_TYPES = ["STOCK", "OPTIONS", "STOCK+OPTIONS"] as const;
const VALID_STATUSES = ["NEW", "ACTIVE", "INVALIDATED", "CLOSED", "EXPIRED"] as const;

router.get("/anomalies", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined;
    const minAvgVolume20d = req.query.minAvgVolume20d ? parseInt(req.query.minAvgVolume20d as string) : undefined;

    const anomalies = await getUniverseAnomalies({ minPrice, maxPrice, minAvgVolume20d }, limit);
    emitTelemetry("API", "INFO", `GET /ai-lab/anomalies — ${anomalies.length} results`, { limit }, "AI_LAB", batch);
    res.json({ anomalies });
  } catch (err: any) {
    emitTelemetry("API", "ERROR", `GET /ai-lab/anomalies failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.get("/ticker/:symbol", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const symbol = req.params.symbol.toUpperCase();
    const lookback = Math.min(parseInt(req.query.lookback as string) || 20, 60);

    const snapshot = await getTickerSnapshot(symbol, lookback);
    if (!snapshot) {
      emitTelemetry("API", "WARN", `GET /ai-lab/ticker/${symbol} — no data`, { symbol }, "AI_LAB", batch);
      return res.status(404).json({ error: "No data for symbol" });
    }
    emitTelemetry("API", "INFO", `GET /ai-lab/ticker/${symbol} — snapshot built`, { symbol }, "AI_LAB", batch);
    res.json({ snapshot });
  } catch (err: any) {
    emitTelemetry("API", "ERROR", `GET /ai-lab/ticker error: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.get("/regime", async (_req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const regime = await getRegimeState();
    emitTelemetry("API", "INFO", `GET /ai-lab/regime — ${regime.trendState}|${regime.volState}`, { regime: regime.trendState }, "AI_LAB", batch);
    res.json({ regime });
  } catch (err: any) {
    emitTelemetry("API", "ERROR", `GET /ai-lab/regime failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.get("/pattern-performance", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const tags = (req.query.tags as string || "").split(",").filter(Boolean);
    if (tags.length === 0) {
      return res.status(400).json({ error: "tags query parameter required (comma-separated)" });
    }
    const perf = await getPatternPerformance(tags);
    emitTelemetry("API", "INFO", `GET /ai-lab/pattern-performance — ${tags.join("+")}`, { tags }, "AI_LAB", batch);
    res.json({ performance: perf });
  } catch (err: any) {
    emitTelemetry("API", "ERROR", `GET /ai-lab/pattern-performance failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.get("/scanner-alignment/:symbol", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const symbol = req.params.symbol.toUpperCase();
    const alignment = await getScannerAlignment(symbol);
    emitTelemetry("API", "INFO", `GET /ai-lab/scanner-alignment/${symbol}`, { symbol }, "AI_LAB", batch);
    res.json({ alignment });
  } catch (err: any) {
    emitTelemetry("API", "ERROR", `GET /ai-lab/scanner-alignment error: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.post("/ideas", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const body = req.body;

    if (!body.symbol || typeof body.symbol !== "string") {
      return res.status(400).json({ error: "symbol is required (string)" });
    }
    if (!VALID_DIRECTIONS.includes(body.direction)) {
      return res.status(400).json({ error: `direction must be one of: ${VALID_DIRECTIONS.join(", ")}` });
    }
    if (!VALID_INSTRUMENT_TYPES.includes(body.instrumentType)) {
      return res.status(400).json({ error: `instrumentType must be one of: ${VALID_INSTRUMENT_TYPES.join(", ")}` });
    }

    const candidate: TradeIdeaCandidate = {
      symbol: String(body.symbol).toUpperCase(),
      direction: body.direction,
      instrumentType: body.instrumentType,
      optionStructureType: body.optionStructureType ?? null,
      legs: body.legs ?? null,
      entrySpreadPct: body.entrySpreadPct != null ? Number(body.entrySpreadPct) : null,
      oiAtEntry: body.oiAtEntry != null ? Number(body.oiAtEntry) : null,
      volumeAtEntry: body.volumeAtEntry != null ? Number(body.volumeAtEntry) : null,
      volumeToOiRatio: body.volumeToOiRatio != null ? Number(body.volumeToOiRatio) : null,
      sector: body.sector ?? null,
    };

    const activeIdeas = await db
      .select()
      .from(aiLabIdeasTable)
      .where(inArray(aiLabIdeasTable.status, ["NEW", "ACTIVE"]));

    const marketData: MarketDataSnapshot = {
      avgVolume20d: 1_000_000,
      dataTimestamp: Date.now() - 5 * 60 * 1000,
    };

    const snapshot = await getTickerSnapshot(candidate.symbol);
    if (snapshot) {
      marketData.avgVolume20d = snapshot.volumeSummary.median20d;
    }

    const validation = await validateAiLabIdea(candidate, activeIdeas, marketData);

    if (!validation.approved) {
      emitTelemetry("STRATEGIST", "WARN", `AI Lab: idea REJECTED for ${candidate.symbol} — ${validation.rejectionReason}`, {
        symbol: candidate.symbol, reason: validation.rejectionReason,
      }, "AI_LAB", batch);
      return res.status(422).json({ rejected: true, reason: validation.rejectionReason });
    }

    const regime = await getRegimeState();

    const signalStrength = typeof body.signalStrength === "number" ? Math.max(0, Math.min(100, body.signalStrength)) : 50;

    const [inserted] = await db
      .insert(aiLabIdeasTable)
      .values({
        symbol: candidate.symbol,
        direction: candidate.direction,
        instrumentType: candidate.instrumentType,
        optionStructureType: candidate.optionStructureType ?? null,
        legs: candidate.legs ?? null,
        entrySpreadPct: candidate.entrySpreadPct ?? null,
        oiAtEntry: candidate.oiAtEntry ?? null,
        volumeAtEntry: candidate.volumeAtEntry ?? null,
        volumeToOiRatio: candidate.volumeToOiRatio ?? null,
        sector: candidate.sector ?? null,
        thesis: typeof body.thesis === "string" ? body.thesis : "N/A",
        catalyst: typeof body.catalyst === "string" ? body.catalyst : "N/A",
        invalidation: typeof body.invalidation === "string" ? body.invalidation : "N/A",
        regimeFit: body.regimeFit ?? "NEUTRAL",
        mainSignals: body.mainSignals ?? null,
        signalStrength,
        convictionLevel: body.convictionLevel ?? "MEDIUM",
        regimeAtCreation: `${regime.trendState}|${regime.volState}|${regime.breadthState}`,
        scannerAlignmentAtCreation: snapshot?.scannerAlignment ?? null,
        status: "NEW",
      })
      .returning();

    emitTelemetry("STRATEGIST", "INFO", `AI Lab: idea CREATED #${inserted.id} for ${candidate.symbol} ${candidate.direction}`, {
      ideaId: inserted.id, symbol: candidate.symbol, direction: candidate.direction,
    }, "AI_LAB", batch);

    res.status(201).json({ idea: inserted });
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ rejected: true, reason: "DUPLICATE_IDEA_CONSTRAINT" });
    }
    emitTelemetry("STRATEGIST", "ERROR", `AI Lab: POST /ideas failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.get("/config", (_req, res) => {
  res.json({ config: getAiLabStrategistConfig() });
});

router.put("/config", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const oldConfig = getAiLabStrategistConfig();
    const updated = updateAiLabStrategistConfig(req.body);
    refreshOrchestratorConfig();

    if (oldConfig.enabled !== updated.enabled) {
      emitTelemetry("STRATEGIST", "INFO", `AI Lab: enabled changed ${oldConfig.enabled} → ${updated.enabled}`, { enabled: updated.enabled }, "AI_LAB", batch);
    }

    res.json({ config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const DEFAULT_PROMPTS: Record<string, string> = {
  shared_context: "",
  analyst: DEFAULT_ANALYST_SYSTEM_PROMPT,
  analyst_rebuttal: DEFAULT_ANALYST_REBUTTAL_SYSTEM_PROMPT,
  skeptic: DEFAULT_SKEPTIC_SYSTEM_PROMPT,
  skeptic_reeval: DEFAULT_SKEPTIC_REEVAL_SYSTEM_PROMPT,
  universe_screener: DEFAULT_UNIVERSE_SCREEN_SYSTEM_PROMPT,
};

router.get("/settings/full", async (_req, res) => {
  try {
    const config = getAiLabFullConfig();
    const defaults = getAiLabConfigDefaults();
    const activePrompts = await getAllActivePrompts();
    res.json({
      config,
      defaults,
      meta: SETTINGS_META,
      promptRoles: PROMPT_ROLES,
      activePrompts,
      defaultPrompts: DEFAULT_PROMPTS,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/settings/update", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: "key and value required" });
    }
    const updated = updateAiLabStrategistConfig({ [key]: value });
    refreshOrchestratorConfig();
    res.json({ config: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/settings/reset", async (_req, res) => {
  try {
    const config = resetAiLabStrategistConfig();
    refreshOrchestratorConfig();
    res.json({ config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/prompts/:role", async (req, res) => {
  try {
    const role = req.params.role as PromptRole;
    if (!PROMPT_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Valid: ${PROMPT_ROLES.join(", ")}` });
    }
    const history = await getPromptHistory(role);
    const defaultText = DEFAULT_PROMPTS[role] ?? "";
    res.json({ role, history, defaultPrompt: defaultText });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/prompts/:role", async (req, res) => {
  try {
    const role = req.params.role as PromptRole;
    if (!PROMPT_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Valid: ${PROMPT_ROLES.join(", ")}` });
    }
    const { promptText } = req.body;
    if (!promptText || typeof promptText !== "string") {
      return res.status(400).json({ error: "promptText is required (string)" });
    }
    const result = await savePrompt(role, promptText);
    res.json({ saved: true, id: result.id, role });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/prompts/:role/reset", async (req, res) => {
  try {
    const role = req.params.role as PromptRole;
    if (!PROMPT_ROLES.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Valid: ${PROMPT_ROLES.join(", ")}` });
    }
    await resetPromptToDefault(role);
    res.json({ reset: true, role });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/prompts/restore/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid prompt ID" });
    const restored = await restorePrompt(id);
    if (!restored) return res.status(404).json({ error: "Prompt not found" });
    res.json({ restored: true, id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/universes", async (req, res) => {
  try {
    const userId = getUserId(req);
    const watchlists = await db.select().from(scannerWatchlistsTable).where(eq(scannerWatchlistsTable.userId, userId));
    const universes = [
      { id: "LIQUID_CORE", name: "Liquid 130", symbolCount: LIQUID_CORE_SYMBOLS.length, source: "preset" },
      ...watchlists.map(w => ({
        id: `watchlist_${w.id}`,
        name: w.name,
        symbolCount: (w.symbols as string[])?.length ?? 0,
        source: "watchlist",
      })),
    ];
    res.json({ universes, active: getAiLabFullConfig().universe });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/ideas", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const statusFilter = (req.query.status as string || "").split(",").filter(Boolean);
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const ideas = statusFilter.length > 0
      ? await db.select().from(aiLabIdeasTable).where(inArray(aiLabIdeasTable.status, statusFilter)).orderBy(desc(aiLabIdeasTable.createdAt)).limit(limit)
      : await db.select().from(aiLabIdeasTable).orderBy(desc(aiLabIdeasTable.createdAt)).limit(limit);

    emitTelemetry("API", "INFO", `GET /ai-lab/ideas — ${ideas.length} results`, { count: ideas.length }, "AI_LAB", batch);
    res.json({ ideas });
  } catch (err: any) {
    emitTelemetry("API", "ERROR", `GET /ai-lab/ideas failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.get("/deliberations", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const decisionFilter = req.query.decision as string | undefined;

    const rows = await db
      .select()
      .from(aiLabDeliberationsTable)
      .orderBy(desc(aiLabDeliberationsTable.createdAt))
      .limit(limit);

    const filtered = decisionFilter
      ? rows.filter((r) => {
          const fd = r.finalDecision as { decision?: string } | null;
          return fd?.decision === decisionFilter;
        })
      : rows;

    emitTelemetry("API", "INFO", `GET /ai-lab/deliberations — ${filtered.length} results`, { count: filtered.length }, "AI_LAB", batch);
    res.json({ deliberations: filtered });
  } catch (err: any) {
    emitTelemetry("API", "ERROR", `GET /ai-lab/deliberations failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.get("/ideas/:id", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid idea ID" });

    const [idea] = await db.select().from(aiLabIdeasTable).where(eq(aiLabIdeasTable.id, id)).limit(1);
    if (!idea) return res.status(404).json({ error: "Idea not found" });

    const outcomes = await db.select().from(aiLabIdeaOutcomesTable).where(eq(aiLabIdeaOutcomesTable.ideaId, id));

    res.json({ idea, outcomes });
  } catch (err: any) {
    emitTelemetry("API", "ERROR", `GET /ai-lab/ideas/${req.params.id} failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/ideas/:id/status", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid idea ID" });

    const { status, invalidatedReason } = req.body;
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const updates: Record<string, unknown> = { status };
    if (status === "INVALIDATED" && invalidatedReason) updates.invalidatedReason = invalidatedReason;
    if (status === "CLOSED" || status === "INVALIDATED" || status === "EXPIRED") updates.closedAt = new Date();

    const [updated] = await db
      .update(aiLabIdeasTable)
      .set(updates)
      .where(eq(aiLabIdeasTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Idea not found" });

    emitTelemetry("STRATEGIST", "INFO", `AI Lab: idea #${id} status → ${status}`, { ideaId: id, status }, "AI_LAB", batch);
    res.json({ idea: updated });
  } catch (err: any) {
    emitTelemetry("STRATEGIST", "ERROR", `PATCH /ideas/${req.params.id}/status failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

const PASS_HANDLERS: Record<string, () => Promise<void>> = {
  OVERNIGHT_DIGEST: overnightDigest,
  PREMARKET_PLAN: preMarketPlan,
  POST_OPEN_CHECK: postOpenCheck,
  MID_MORNING_SCAN: midMorningScan,
  MIDDAY_ROTATION: middayRotationCheck,
  POWER_HOUR_PREP: powerHourPrep,
  POST_MARKET_REFLECTION: postMarketReflection,
};

router.post("/orchestrator/run-pass", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const { passName } = req.body;
    const handler = PASS_HANDLERS[passName];
    if (!handler) {
      return res.status(400).json({ error: `Unknown pass. Valid: ${Object.keys(PASS_HANDLERS).join(", ")}` });
    }

    handler().catch((err) => {
      emitTelemetry("STRATEGIST", "ERROR", `AI Lab: manual ${passName} failed: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    });

    res.json({ status: "started", passName });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/orchestrator/trigger/price-shock", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const { symbol, movePct, windowMinutes, volumeSpikeRatio } = req.body;
    if (!symbol || movePct == null) {
      return res.status(400).json({ error: "symbol and movePct required" });
    }

    const result = await priceShockTrigger(
      String(symbol).toUpperCase(),
      Number(movePct),
      Number(windowMinutes ?? 15),
      Number(volumeSpikeRatio ?? 1.0),
    );

    res.json({ result: result ?? { filtered: true } });
  } catch (err: any) {
    emitTelemetry("STRATEGIST", "ERROR", `price-shock trigger error: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.post("/orchestrator/trigger/block-flow", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const { symbol, blockNotional, blockPctOfADV } = req.body;
    if (!symbol || blockNotional == null) {
      return res.status(400).json({ error: "symbol and blockNotional required" });
    }

    const result = await blockFlowTrigger(
      String(symbol).toUpperCase(),
      Number(blockNotional),
      Number(blockPctOfADV ?? 0),
    );

    res.json({ result: result ?? { filtered: true } });
  } catch (err: any) {
    emitTelemetry("STRATEGIST", "ERROR", `block-flow trigger error: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.post("/orchestrator/trigger/scanner-score", async (req, res) => {
  const batch = createTelemetryBatch("AI_LAB");
  try {
    const { symbol, deltaDiscovery, deltaMomentum } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: "symbol required" });
    }

    const result = await scannerScoreJumpTrigger(
      String(symbol).toUpperCase(),
      Number(deltaDiscovery ?? 0),
      Number(deltaMomentum ?? 0),
    );

    res.json({ result: result ?? { filtered: true } });
  } catch (err: any) {
    emitTelemetry("STRATEGIST", "ERROR", `scanner-score trigger error: ${err.message}`, { error: err.message }, "AI_LAB", batch);
    res.status(500).json({ error: err.message });
  }
});

router.get("/orchestrator/watchlist", async (_req, res) => {
  try {
    const entries = await db
      .select()
      .from(aiLabWatchlistTable)
      .orderBy(desc(aiLabWatchlistTable.compositeScore))
      .limit(100);

    res.json({ entries });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
