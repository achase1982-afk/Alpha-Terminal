import { Router, type IRouter } from "express";
import { getLatestMoversFeed } from "../lib/movers/moversFeedStore.js";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  try {
    const feed = await getLatestMoversFeed();
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: "Failed to load movers feed" });
  }
});

export default router;
