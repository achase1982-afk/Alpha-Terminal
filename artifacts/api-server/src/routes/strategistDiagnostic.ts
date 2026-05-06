import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, strategistHistoryTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import type { StrategistDiagnosticView } from "../lib/strategistDiagnosticView.js";

const router: IRouter = Router();

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): { ok: boolean; error?: string } {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { ok: false, error: "ADMIN_API_KEY is not set on the server" };
  if (req.headers["x-admin-key"] !== adminKey) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

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

/**
 * GET /conviction-diagnostic/:runId — admin-only; returns persisted Conviction Desk diagnostic blob from history.
 * Header: x-admin-key (ADMIN_API_KEY). Same run id as POST /analyze jobId.
 */
router.get("/conviction-diagnostic/:runId", async (req, res): Promise<void> => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) {
    const status = auth.error?.includes("ADMIN_API_KEY") ? 503 : 401;
    res.status(status).json({ error: auth.error ?? "Unauthorized" });
    return;
  }
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
      res.status(404).json({ error: "analyze history row not found for this run" });
      return;
    }
    const deskResult = card["deskResult"] as Record<string, unknown> | undefined;
    const diag = deskResult?.["convictionDeskRunDiagnostic"];
    if (!diag || typeof diag !== "object" || Array.isArray(diag)) {
      res.status(404).json({
        error: "Conviction Desk diagnostic not stored for this run",
        hint: "Only Conviction Desk mode (5) persists this payload.",
      });
      return;
    }
    const body = JSON.stringify(diag);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "inline");
    res.status(200).send(body);
  } catch (err) {
    logger.error({ err, runId }, "Strategist conviction diagnostic route failed");
    res.status(500).json({ error: "Failed to load conviction diagnostic" });
  }
});

export default router;
