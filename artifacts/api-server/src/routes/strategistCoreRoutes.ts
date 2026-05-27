import { Router, type IRouter, type Request, type Response } from "express";
import { requireStrategistUserId } from "../lib/strategistAuth.js";
import { isStrategistV3Enabled } from "../lib/strategistV3/config.js";
import {
  cancelJob,
  findActiveDuplicate,
  findJobById,
  insertQueuedJob,
  listActiveJobsForUser,
} from "../lib/strategistV3/jobs.js";
import { resolveStrategistPollPayload } from "../lib/strategistV3/resolvePoll.js";
import { parseScannerContext } from "../lib/scannerStrategistContext.js";
import type { ValidationTicket } from "../lib/strategistValidate.js";
import { markStrategistAnalyzeCancelled } from "../lib/strategistAnalyzeCancellation.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function unavailable(res: Response): void {
  res.status(503).json({ error: "strategist_unavailable", message: "Strategist is temporarily unavailable." });
}

function requireV3Enabled(req: Request, res: Response): boolean {
  if (isStrategistV3Enabled()) return true;
  unavailable(res);
  return false;
}

router.get("/jobs/active", async (req, res): Promise<void> => {
  const userId = requireStrategistUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const active = await listActiveJobsForUser(userId);
    res.json({ active });
  } catch (err) {
    logger.error({ err }, "StrategistV3: GET /jobs/active failed");
    res.status(500).json({ error: "Failed to fetch active jobs" });
  }
});

router.post("/analyze/cancel", async (req, res): Promise<void> => {
  if (!requireV3Enabled(req, res)) return;
  const userId = requireStrategistUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const { jobId } = req.body as { jobId?: string };
    if (!jobId || typeof jobId !== "string") {
      res.status(400).json({ error: "jobId is required" });
      return;
    }
    const job = await findJobById(jobId);
    if (!job || job.userId !== userId) {
      res.status(404).json({ error: "job not found or not cancellable" });
      return;
    }
    if (job.kind !== "analyze" || !["queued", "running"].includes(job.status)) {
      res.status(404).json({ error: "job not found or not cancellable" });
      return;
    }
    await cancelJob(jobId);
    markStrategistAnalyzeCancelled(jobId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "StrategistV3: analyze cancel failed");
    res.status(500).json({ error: "Cancel failed" });
  }
});

router.post("/analyze", async (req, res): Promise<void> => {
  if (!requireV3Enabled(req, res)) return;
  const userId = requireStrategistUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const { ticker, jobId, flowContext, scannerContext, convictionDeskProvider, clientTimeZone } = req.body as {
      ticker?: string;
      jobId?: string;
      flowContext?: string;
      scannerContext?: unknown;
      convictionDeskProvider?: unknown;
      clientTimeZone?: string;
    };

    if (!ticker || typeof ticker !== "string") {
      res.status(400).json({ error: "ticker is required" });
      return;
    }
    if (!jobId || typeof jobId !== "string") {
      res.status(400).json({ error: "jobId is required" });
      return;
    }

    const existingById = await findJobById(jobId);
    if (existingById) {
      res.json({ jobId, accepted: true });
      return;
    }

    const upperTicker = ticker.toUpperCase();
    const duplicate = await findActiveDuplicate(userId, upperTicker, "analyze");
    if (duplicate) {
      res.json({ jobId: duplicate.id, accepted: true, deduped: true });
      return;
    }

    await insertQueuedJob({
      id: jobId,
      userId,
      kind: "analyze",
      ticker: upperTicker,
      params: {
        flowContext: typeof flowContext === "string" ? flowContext.slice(0, 8000) : undefined,
        scannerContext: parseScannerContext(scannerContext) ?? undefined,
        convictionDeskProvider,
        clientTimeZone: typeof clientTimeZone === "string" ? clientTimeZone : undefined,
      },
    });

    res.json({ jobId, accepted: true });
  } catch (err) {
    logger.error({ err }, "StrategistV3: analyze enqueue failed");
    res.status(500).json({ error: "Analysis failed to start" });
  }
});

router.post("/validate-trade", async (req, res): Promise<void> => {
  if (!requireV3Enabled(req, res)) return;
  const userId = requireStrategistUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
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

    const existingById = await findJobById(jobId);
    if (existingById) {
      res.json({ jobId, accepted: true });
      return;
    }

    const upperTicker = String(ticket.ticker).toUpperCase();
    const duplicate = await findActiveDuplicate(userId, upperTicker, "validate_trade");
    if (duplicate) {
      res.json({ jobId: duplicate.id, accepted: true, deduped: true });
      return;
    }

    await insertQueuedJob({
      id: jobId,
      userId,
      kind: "validate_trade",
      ticker: upperTicker,
      params: {
        ticket: { ...ticket, ticker: upperTicker },
        thesis: typeof thesis === "string" ? thesis.slice(0, 4000) : undefined,
        rollingShort: rollingShort === true,
      },
    });

    res.json({ jobId, accepted: true });
  } catch (err) {
    logger.error({ err }, "StrategistV3: validate-trade enqueue failed");
    res.status(500).json({ error: "Validation failed to start" });
  }
});

async function handlePoll(req: Request, res: Response): Promise<void> {
  const userId = requireStrategistUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const jobId = String(req.params.jobId ?? "");
  if (!jobId) {
    res.status(400).json({ error: "jobId required" });
    return;
  }
  const sinceRaw = req.query.since;
  const since = typeof sinceRaw === "string" ? Math.max(0, parseInt(sinceRaw, 10) || 0) : 0;
  try {
    const payload = await resolveStrategistPollPayload(jobId, since, userId);
    if (!payload) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(payload);
  } catch (err) {
    logger.error({ err, jobId }, "StrategistV3: poll failed");
    res.status(500).json({ error: "Failed to load job" });
  }
}

router.get("/job/:jobId/final", (req, res) => void handlePoll(req, res));
router.get("/thinking/:jobId", (req, res) => void handlePoll(req, res));

export default router;
