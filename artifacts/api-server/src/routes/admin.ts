import { Router, type Request } from "express";
import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger.js";
import { runIbkrTickEntitlementPilotSerialized } from "../lib/ibkrTickEntitlementPilot.js";
import {
  backfillAnalystEstimates,
  backfillAnalystGrades,
  backfillAnalystPriceTargets,
  backfillEarningsCalendar,
  backfillEarningsSurprises,
  backfillEconomicCalendar,
  backfillEquityDailyHistory,
} from "../lib/fmpBackfill.js";

const router = Router();

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): { ok: boolean; error?: string } {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { ok: false, error: "ADMIN_API_KEY is not set on the server" };
  if (req.headers["x-admin-key"] !== adminKey) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

const DEV_BYPASS_AUTH = process.env.DEV_BYPASS_AUTH === "true";

/** Clerk session (UI) or x-admin-key (scripts); dev bypass matches app.ts. */
function requireIbkrTickPilotTrigger(req: Request): { ok: boolean; error?: string } {
  if (DEV_BYPASS_AUTH) return { ok: true };
  try {
    const { userId } = getAuth(req);
    if (userId) return { ok: true };
  } catch {
    /* getAuth unavailable */
  }
  return requireAdmin(req);
}

const FMP_BACKFILL_JOBS = {
  earnings_calendar: backfillEarningsCalendar,
  economic_calendar: backfillEconomicCalendar,
  analyst_price_targets: backfillAnalystPriceTargets,
  analyst_grades: backfillAnalystGrades,
  earnings_surprises: backfillEarningsSurprises,
  equity_daily_history: backfillEquityDailyHistory,
  analyst_estimates: backfillAnalystEstimates,
} as const;

type FmpBackfillJob = keyof typeof FMP_BACKFILL_JOBS;

/**
 * POST /api/admin/fmp/backfill
 * Header: x-admin-key: <ADMIN_API_KEY>
 * Body: { "job": ... } — see `allowed` in error responses for current keys.
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

/**
 * POST /api/admin/diagnostics/ibkr-tick-pilot
 * Auth: signed-in Clerk session (from UI) or header x-admin-key: <ADMIN_API_KEY> (curl/scripts).
 * Body optional: { "triggeredByUserId": "user_xxx" } — otherwise uses Clerk `userId` when session is present, else `"admin-key"`.
 *
 * Runs a 60s IBKR tick-by-tick Last entitlement capture (dedicated API clientId).
 */
router.post("/diagnostics/ibkr-tick-pilot", async (req, res) => {
  const auth = requireIbkrTickPilotTrigger(req);
  if (!auth.ok) {
    return res.status(403).json({ ok: false, error: auth.error });
  }

  let triggeredBy = "admin-key";
  try {
    const clerk = getAuth(req as never);
    if (typeof req.body?.triggeredByUserId === "string" && req.body.triggeredByUserId.trim()) {
      triggeredBy = req.body.triggeredByUserId.trim();
    } else if (clerk.userId) {
      triggeredBy = clerk.userId;
    }
  } catch {
    if (typeof req.body?.triggeredByUserId === "string" && req.body.triggeredByUserId.trim()) {
      triggeredBy = req.body.triggeredByUserId.trim();
    }
  }

  try {
    const result = await runIbkrTickEntitlementPilotSerialized(triggeredBy);
    const slim = {
      ...result,
      perSymbolResults: result.perSymbolResults.map(({ ticks, ...rest }) => ({
        ...rest,
        tickSample: ticks[0] ?? null,
        ticksCaptured: ticks.length,
      })),
    };
    return res.json({ ok: true, ...slim });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("already running")) {
      return res.status(409).json({ ok: false, error: msg });
    }
    logger.error({ err: msg }, "admin: ibkr tick pilot failed");
    return res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
