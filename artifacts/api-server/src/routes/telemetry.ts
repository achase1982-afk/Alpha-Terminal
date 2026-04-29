import { Router, type IRouter } from "express";
import {
  getEvents,
  getGroupedEvents,
  getSystemCounts,
  resetSystemCount,
  resolveEvent,
  clearAllEvents,
  getTotalCount,
} from "../lib/telemetryStore.js";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const system = req.query.system as string | undefined;
    const severity = req.query.severity as string | undefined;
    const showResolved = req.query.showResolved === "true";
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 500, 2000));
    const grouped = req.query.grouped === "true";

    if (grouped) {
      const result = getGroupedEvents({ system, severity, showResolved, limit });
      return res.json(result);
    } else {
      const entries = getEvents({ system, severity, showResolved, limit });
      return res.json({ entries });
    }
  } catch (err: any) {
    req.log.error({ err }, "Telemetry fetch error");
    return res.status(500).json({ error: "Failed to fetch telemetry" });
  }
});

router.get("/counts", async (_req, res) => {
  try {
    const totals = getTotalCount();
    const perSystem = getSystemCounts();
    res.json({ unresolvedCount: totals.errors + totals.warns, total: totals.total, errors: totals.errors, warns: totals.warns, perSystem });
    return;
  } catch {
    return res.json({ unresolvedCount: 0, total: 0, errors: 0, warns: 0, perSystem: {} });
  }
});

router.post("/reset-count/:system", async (req, res) => {
  resetSystemCount(req.params.system);
  return res.json({ ok: true });
});

router.patch("/:id/resolve", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ok = resolveEvent(id);
    return res.json({ ok });
  } catch (err: any) {
    req.log.error({ err }, "Telemetry resolve error");
    return res.status(500).json({ error: "Failed to resolve" });
  }
});

router.delete("/clear", async (_req, res) => {
  clearAllEvents();
  return res.json({ ok: true });
});

export default router;
