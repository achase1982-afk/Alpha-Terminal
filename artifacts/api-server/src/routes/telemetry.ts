import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { failureLogTable } from "@workspace/db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const system = req.query.system as string | undefined;
    const severity = req.query.severity as string | undefined;
    const since = req.query.since as string | undefined;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 100, 500));

    const conditions = [];
    if (system) conditions.push(eq(failureLogTable.system, system));
    if (severity) conditions.push(eq(failureLogTable.severity, severity));
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gte(failureLogTable.timestamp, sinceDate));
      }
    }

    const entries = await db
      .select()
      .from(failureLogTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(failureLogTable.timestamp))
      .limit(limit);

    res.json({ entries });
  } catch (err: any) {
    req.log.error({ err }, "Telemetry fetch error");
    res.status(500).json({ error: "Failed to fetch telemetry" });
  }
});

router.get("/counts", async (_req, res) => {
  try {
    const [result] = await db
      .select({
        count: sql<number>`count(*) filter (where ${failureLogTable.severity} in ('ERROR', 'CRITICAL') and ${failureLogTable.resolved} = false)`,
      })
      .from(failureLogTable);

    res.json({ unresolvedCount: Number(result?.count ?? 0) });
  } catch {
    res.json({ unresolvedCount: 0 });
  }
});

router.patch("/:id/resolve", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    await db
      .update(failureLogTable)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(eq(failureLogTable.id, id));

    res.json({ ok: true });
  } catch (err: any) {
    req.log.error({ err }, "Telemetry resolve error");
    res.status(500).json({ error: "Failed to resolve" });
  }
});

router.delete("/clear-resolved", async (_req, res) => {
  try {
    await db
      .delete(failureLogTable)
      .where(eq(failureLogTable.resolved, true));

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to clear resolved" });
  }
});

export default router;
