import { Router, type IRouter } from "express";
import { getLatestMoversFeed } from "../lib/movers/moversFeedStore.js";
import { requestMoversPollNow } from "../lib/movers/moversPollWorker.js";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  try {
    const feed = await getLatestMoversFeed();
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: "Failed to load movers feed" });
  }
});

/** Force an immediate FMP poll (debounced ~30s server-side). */
router.post("/refresh", async (_req, res) => {
  try {
    const result = await requestMoversPollNow();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to refresh movers feed" });
  }
});

export default router;
