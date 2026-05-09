import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { tradeJournalTable, stagedExitsTable } from "@workspace/db/schema";
import { eq, desc } from "@workspace/db";
import { logger } from "../lib/logger.js";

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

export default router;
