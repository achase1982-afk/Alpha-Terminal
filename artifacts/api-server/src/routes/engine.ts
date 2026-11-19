import { Router, type IRouter } from "express";
import { startEngine, stopEngine, engineStatus } from "../engine/index.js";
import { readRawConfig, writeConfigPatch, configExists } from "../engine/config.js";
import { getTodayTrades, getTodaySignals } from "../engine/logger.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/** GET /engine/status — current engine state */
router.get("/status", (_req, res) => {
  res.json(engineStatus());
});

/** GET /engine/config — read config.yaml */
router.get("/config", (_req, res) => {
  if (!configExists()) { res.status(404).json({ error: "config.yaml not found" }); return; }
  res.json(readRawConfig());
});

/** POST /engine/config — patch config.yaml fields */
router.post("/config", (req, res) => {
  try {
    writeConfigPatch(req.body as Record<string, unknown>);
    res.json({ ok: true, config: readRawConfig() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[engine/config] write failed");
    res.status(400).json({ error: msg });
  }
});

/** GET /engine/trades — today's exits */
router.get("/trades", (_req, res) => {
  try {
    res.json(getTodayTrades());
  } catch {
    res.json([]);
  }
});

/** GET /engine/signals — today's signals */
router.get("/signals", (_req, res) => {
  try {
    res.json(getTodaySignals());
  } catch {
    res.json([]);
  }
});

/**
 * POST /engine/control
 * Body: { action: "start" | "stop" | "kill" }
 */
router.post("/control", async (req, res) => {
  const { action } = req.body as { action?: string };

  try {
    switch (action) {
      case "start":
        startEngine();
        return res.json({ ok: true, status: engineStatus() });

      case "stop":
        stopEngine();
        return res.json({ ok: true });

      case "kill":
        stopEngine();
        return res.json({ ok: true, killed: true });

      default:
        return res.status(400).json({ error: `unknown action: ${action}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, action }, "[engine/control] failed");
    return res.status(500).json({ error: msg });
  }
});

export default router;
