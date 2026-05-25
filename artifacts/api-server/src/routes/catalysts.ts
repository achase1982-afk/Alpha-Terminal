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

router.post("/rebuild", async (req, res) => {
  try {
    void runCatalystsRebuildOnce();
    const feed = await getLatestCatalystsFeed();
    return res.json({ ok: true, feed });
  } catch (err) {
    req.log?.error({ err }, "Catalysts rebuild request failed");
    return res.status(500).json({ error: "Failed to start catalysts rebuild" });
  }
});

export default router;
