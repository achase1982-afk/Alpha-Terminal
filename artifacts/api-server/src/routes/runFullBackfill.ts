import { Router } from "express";
import { eq } from "@workspace/db";
import { backfillRunJobsTable, db } from "@workspace/db";
import { enqueueFullBackfillJob } from "../lib/fullBackfillOrchestrator.js";

const router = Router();

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): { ok: boolean; error?: string } {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { ok: false, error: "ADMIN_API_KEY is not set on the server" };
  if (req.headers["x-admin-key"] !== adminKey) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/run-full-backfill (mounted at /api/admin/run-full-backfill)
 * Header: x-admin-key
 */
router.post("/", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

  try {
    const { jobId } = await enqueueFullBackfillJob();
    return res.status(202).json({
      ok: true,
      job_id: jobId,
      status_url: `/api/admin/run-full-backfill/${jobId}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
});

/**
 * GET /api/admin/run-full-backfill/:id
 */
router.get("/:id", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) {
    return res.status(400).json({ ok: false, error: "Invalid job id" });
  }

  const [row] = await db.select().from(backfillRunJobsTable).where(eq(backfillRunJobsTable.id, id)).limit(1);
  if (!row) {
    return res.status(404).json({ ok: false, error: "Job not found" });
  }

  return res.json({
    ok: true,
    job: row,
  });
});

export default router;
