import { Router, type IRouter } from "express";
import { requireStrategistUserId } from "../lib/strategistAuth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * GET /jobs/active — Strategist V3 status bar (Phase 1: empty list).
 * Scoped to authenticated user_id; never trust client-supplied identity headers.
 */
router.get("/jobs/active", async (req, res): Promise<void> => {
  const userId = requireStrategistUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    // Phase 2+: query strategist_jobs WHERE user_id = userId AND status IN ('queued','running')
    void userId;
    res.json({ active: [] });
  } catch (err) {
    logger.error({ err }, "StrategistV3: GET /jobs/active failed");
    res.status(500).json({ error: "Failed to fetch active jobs" });
  }
});

export default router;
