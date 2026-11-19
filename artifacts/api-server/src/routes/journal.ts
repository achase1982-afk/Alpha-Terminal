import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tradeJournalTable, stagedExitsTable } from "@workspace/db/schema";
import { eq, desc } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { importCsvFills } from "../journalInsights/csvImport.js";
import { loadActivities, readInsights } from "../journalInsights/store.js";
import { startJournalSync } from "../journalInsights/sync.js";
import type { InsightPeriod } from "../journalInsights/types.js";

function periodOf(value: unknown): InsightPeriod {
  if (value === "30d" || value === "90d" || value === "lifetime" || value === "ytd") return value;
  return "ytd";
}

function accountOf(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "all_live";
}

function syncStatus(result: { ok: boolean; reason?: string }): "ok" | "busy" | "no_token" | "failed" {
  if (result.reason === "busy" || result.reason === "no_token" || result.reason === "failed") return result.reason;
  return result.ok ? "ok" : "failed";
}

const router: IRouter = Router();

router.get("/entries", async (_req, res) => {
  try {
    const entries = await db
      .select()
      .from(tradeJournalTable)
      .orderBy(desc(tradeJournalTable.createdAt));
    res.json(entries);
    return;
  } catch (err) {
    logger.error({ err }, "Failed to fetch journal entries");
    return res.status(500).json({ error: "db_error" });
  }
});

router.get("/entries/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const [entry] = await db
      .select()
      .from(tradeJournalTable)
      .where(eq(tradeJournalTable.id, id));
    if (!entry) return res.status(404).json({ error: "not_found" });

    const exits = await db
      .select()
      .from(stagedExitsTable)
      .where(eq(stagedExitsTable.journalEntryId, id));

    res.json({ ...entry, stagedExits: exits });
    return;
  } catch (err) {
    logger.error({ err }, "Failed to fetch journal entry");
    return res.status(500).json({ error: "db_error" });
  }
});

router.post("/entries", async (req, res) => {
  try {
    const [entry] = await db
      .insert(tradeJournalTable)
      .values(req.body)
      .returning();
    res.json(entry);
    return;
  } catch (err) {
    logger.error({ err }, "Failed to create journal entry");
    return res.status(500).json({ error: "db_error" });
  }
});

router.patch("/entries/:id/result", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
    const { exitPrice, realizedPL, resultNote, followedPlan } = req.body;
    const [updated] = await db
      .update(tradeJournalTable)
      .set({
        exitPrice: exitPrice ?? null,
        realizedPL: realizedPL ?? null,
        resultNote: resultNote ?? null,
        followedPlan: followedPlan ?? null,
        resultLoggedAt: new Date(),
      })
      .where(eq(tradeJournalTable.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "not_found" });
    return res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to log result");
    return res.status(500).json({ error: "db_error" });
  }
});

router.get("/stats", async (_req, res) => {
  try {
    const entries = await db.select().from(tradeJournalTable);
    const total = entries.length;
    const withResult = entries.filter(e => e.resultLoggedAt != null);
    const wins = withResult.filter(e => (e.realizedPL ?? 0) > 0);
    const winRate = withResult.length > 0 ? (wins.length / withResult.length) * 100 : 0;
    const avgPL = withResult.length > 0 ? withResult.reduce((s, e) => s + (e.realizedPL ?? 0), 0) / withResult.length : 0;

    const modeBreakdown: Record<string, { count: number; wins: number; total: number }> = {};
    for (const e of entries) {
      const mode = e.tradingModeLabel ?? `Mode ${e.tradingMode ?? "?"}`;
      if (!modeBreakdown[mode]) modeBreakdown[mode] = { count: 0, wins: 0, total: 0 };
      modeBreakdown[mode].count++;
      if (e.resultLoggedAt) {
        modeBreakdown[mode].total++;
        if ((e.realizedPL ?? 0) > 0) modeBreakdown[mode].wins++;
      }
    }

    res.json({ total, withResultCount: withResult.length, winRate, avgPL, modeBreakdown });
  } catch (err) {
    logger.error({ err }, "Failed to fetch stats");
    res.status(500).json({ error: "db_error" });
  }
});

router.get("/staged-exits", async (_req, res) => {
  try {
    const exits = await db
      .select()
      .from(stagedExitsTable)
      .orderBy(desc(stagedExitsTable.createdAt));
    res.json(exits);
  } catch (err) {
    logger.error({ err }, "Failed to fetch staged exits");
    res.status(500).json({ error: "db_error" });
  }
});

router.get("/insights", async (req, res) => {
  const period = periodOf(req.query.period);
  const accountId = accountOf(req.query.accountId);
  try {
    const payload = await readInsights(period, new Date(), accountId);
    res.json(payload);
    return;
  } catch (err) {
    logger.error({ err }, "Journal insights failed");
    return res.status(500).json({ error: "journal_unavailable" });
  }
});

router.get("/trades", async (req, res) => {
  const period = periodOf(req.query.period);
  const accountId = accountOf(req.query.accountId);
  try {
    const payload = await readInsights(period, new Date(), accountId);
    res.json({ accountId, period, positions: payload.positions });
    return;
  } catch (err) {
    logger.error({ err }, "Journal trades failed");
    return res.status(500).json({ error: "journal_unavailable" });
  }
});

router.post("/import-csv", async (req, res) => {
  const body = req.body as { format?: unknown; accountId?: unknown; csv?: unknown };
  const format = typeof body.format === "string" ? body.format : "generic";
  const accountId = accountOf(body.accountId);
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (accountId === "all_live" || !csv.trim()) {
    return res.status(400).json({ error: "csv_target_required" });
  }
  try {
    const existing = await loadActivities();
    const result = await importCsvFills({
      csv,
      format,
      accountId,
      existingIds: new Set(existing.map((activity) => activity.id)),
    });
    res.json(result);
    return;
  } catch (err) {
    logger.error({ err }, "Journal csv import failed");
    return res.status(500).json({ error: "journal_unavailable" });
  }
});

router.post("/sync", async (_req, res) => {
  try {
    const result = await startJournalSync();
    const status = syncStatus(result);
    if (status === "no_token") {
      return res.status(401).json({ ...result, status });
    }
    res.json({ ...result, status });
    return;
  } catch (err) {
    logger.error({ err }, "Journal sync failed");
    return res.status(500).json({ status: "failed", error: "journal_unavailable" });
  }
});

export default router;
