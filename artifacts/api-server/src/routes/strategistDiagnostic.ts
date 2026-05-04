import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, strategistHistoryTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import type { StrategistDiagnosticView } from "../lib/strategistDiagnosticView.js";

const router: IRouter = Router();

/**
 * GET /diagnostic/:runId — returns persisted `diagnosticView` for analyze jobs.
 * `runId` is the strategist job id (same as POST /analyze `jobId`).
 */
router.get("/diagnostic/:runId", async (req, res): Promise<void> => {
  const runId = req.params.runId;
  if (!runId || typeof runId !== "string") {
    res.status(400).json({ error: "runId required" });
    return;
  }
  try {
    const rows = await db
      .select({ cardJson: strategistHistoryTable.cardJson })
      .from(strategistHistoryTable)
      .where(and(eq(strategistHistoryTable.jobId, runId), eq(strategistHistoryTable.cleared, false)))
      .limit(1);
    const card = rows[0]?.cardJson as Record<string, unknown> | undefined;
    if (!card || card["kind"] === "validation") {
      res.status(404).json({ error: "diagnostic view not found for this run" });
      return;
    }
    const dv = card["diagnosticView"];
    if (!dv || typeof dv !== "object" || Array.isArray(dv)) {
      res.status(404).json({
        error: "diagnostic view not stored for this run",
        hint: "Runs completed before diagnosticView was added do not have a persisted projection.",
      });
      return;
    }
    const body = JSON.stringify(dv as StrategistDiagnosticView);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "inline");
    res.status(200).send(body);
  } catch (err) {
    logger.error({ err, runId }, "Strategist diagnostic route failed");
    res.status(500).json({ error: "Failed to load diagnostic view" });
  }
});

export default router;
