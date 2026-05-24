import { Router, type IRouter } from "express";
import { getLatestMoversFeed } from "../lib/movers/moversFeedStore.js";
import { getOrCreateMoversSituationRead } from "../lib/movers/moversCatalystRead.js";
import { requestMoversPollNow, runMoversPollOnce } from "../lib/movers/moversPollWorker.js";

const router: IRouter = Router();

async function loadMoversFeedForClient(): Promise<Awaited<ReturnType<typeof getLatestMoversFeed>>> {
  let feed = await getLatestMoversFeed();
  // Nothing persisted yet — poll once so the UI is not stuck at 0/0/0/0 after deploy.
  if (!feed.capturedAt) {
    await runMoversPollOnce();
    feed = await getLatestMoversFeed();
  }
  return feed;
}

router.get("/", async (_req, res) => {
  try {
    const feed = await loadMoversFeedForClient();
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: "Failed to load movers feed" });
  }
});

/** Force an immediate FMP poll (debounced ~30s server-side). */
router.get("/read", async (req, res) => {
  try {
    const situationId = typeof req.query.id === "string" ? req.query.id.trim() : "";
    if (!situationId) {
      return res.status(400).json({ error: "Query parameter id is required" });
    }
    const read = await getOrCreateMoversSituationRead(situationId);
    return res.json(read);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return res.status(500).json({ error: "Failed to load movers read" });
  }
});

router.post("/refresh", async (_req, res) => {
  try {
    const result = await requestMoversPollNow();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to refresh movers feed" });
  }
});

export default router;
