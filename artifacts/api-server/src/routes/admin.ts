import { Router } from "express";
import { logger } from "../lib/logger.js";
import {
  backfillAnalystGrades,
  backfillAnalystPriceTargets,
  backfillEarningsCalendar,
  backfillEarningsSurprises,
  backfillEconomicCalendar,
} from "../lib/fmpBackfill.js";

const router = Router();

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): { ok: boolean; error?: string } {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { ok: false, error: "ADMIN_API_KEY is not set on the server" };
  if (req.headers["x-admin-key"] !== adminKey) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

const FMP_BACKFILL_JOBS = {
  earnings_calendar: backfillEarningsCalendar,
  economic_calendar: backfillEconomicCalendar,
  analyst_price_targets: backfillAnalystPriceTargets,
  analyst_grades: backfillAnalystGrades,
  earnings_surprises: backfillEarningsSurprises,
} as const;

type FmpBackfillJob = keyof typeof FMP_BACKFILL_JOBS;

/**
 * POST /api/admin/fmp/backfill
 * Header: x-admin-key: <ADMIN_API_KEY>
 * Body: { "job": "earnings_calendar" | "economic_calendar" | "analyst_price_targets" | "analyst_grades" | "earnings_surprises" }
 */
router.post("/fmp/backfill", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) {
    return res.status(403).json({ ok: false, error: auth.error });
  }

  const job = (req.body?.job ?? req.body?.backfill) as string | undefined;
  if (!job || typeof job !== "string") {
    return res.status(400).json({
      ok: false,
      error: "Missing body.job",
      allowed: Object.keys(FMP_BACKFILL_JOBS),
    });
  }

  const normalized = job.trim().toLowerCase().replace(/-/g, "_") as FmpBackfillJob;
  const fn = FMP_BACKFILL_JOBS[normalized as FmpBackfillJob];
  if (!fn) {
    return res.status(400).json({
      ok: false,
      error: `Unknown job: ${job}`,
      allowed: Object.keys(FMP_BACKFILL_JOBS),
    });
  }

  try {
    logger.info({ job: normalized }, "admin: FMP backfill triggered manually");
    const result = await fn();
    return res.json({ ok: true, job: normalized, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ err: msg, job: normalized }, "admin: FMP backfill failed");
    return res.status(500).json({ ok: false, job: normalized, error: msg });
  }
});

export default router;
