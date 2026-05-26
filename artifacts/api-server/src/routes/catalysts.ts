import { Router } from "express";
import { getLatestCatalystsFeed } from "../lib/catalysts/catalystsFeedStore.js";
import { runCatalystsRebuildOnce } from "../lib/catalysts/catalystsRebuildWorker.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const feed = await getLatestCatalystsFeed();
    return res.json(feed);
  } catch (err) {
    _req.log?.error({ err }, "Catalysts feed read failed");
    return res.status(500).json({ error: "Failed to load catalysts feed" });
  }
});

async function rebuildAndReturnFeed() {
  await runCatalystsRebuildOnce();
  return getLatestCatalystsFeed();
}

/** Rebuild catalysts feed from harvest + tradeability gates (same as nightly job). */
router.post("/rebuild", async (req, res) => {
  try {
    const feed = await rebuildAndReturnFeed();
    return res.json({ ok: true, feed });
  } catch (err) {
    req.log?.error({ err }, "Catalysts rebuild request failed");
    return res.status(500).json({ error: "Failed to rebuild catalysts feed" });
  }
});

/** Alias for UI refresh — awaits full rebuild, not a cache read. */
router.post("/refresh", async (req, res) => {
  try {
    const feed = await rebuildAndReturnFeed();
    return res.json({ ok: true, feed });
  } catch (err) {
    req.log?.error({ err }, "Catalysts refresh request failed");
    return res.status(500).json({ error: "Failed to refresh catalysts feed" });
  }
});

export default router;
