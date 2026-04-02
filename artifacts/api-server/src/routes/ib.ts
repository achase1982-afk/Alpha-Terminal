import { Router, type Request, type Response } from "express";
import {
  connectIB,
  disconnectIB,
  isIBConnected,
  getIBStatus,
  getIBSnapshot,
  getIBSymbolList,
  getIBNewsProviders,
  getIBLiveNews,
  fetchIBHistoricalNews,
  fetchIBNewsArticle,
  fetchNewsForSymbol,
} from "../lib/ibStreamer.js";

const router = Router();

router.get("/status", (_req: Request, res: Response) => {
  res.json(getIBStatus());
});

router.get("/symbols", (_req: Request, res: Response) => {
  res.json(getIBSymbolList());
});

router.get("/snapshot", (_req: Request, res: Response) => {
  res.json(getIBSnapshot());
});

router.post("/connect", async (_req: Request, res: Response) => {
  if (isIBConnected()) {
    res.json({ status: "already_connected" });
    return;
  }
  try {
    await connectIB();
    res.json({ status: "connecting", message: "Connection attempt initiated" });
  } catch (err) {
    res.status(500).json({ error: "Failed to initiate IB connection" });
  }
});

router.post("/disconnect", (_req: Request, res: Response) => {
  disconnectIB();
  res.json({ status: "disconnected" });
});

router.get("/news/providers", (_req: Request, res: Response) => {
  if (!isIBConnected()) {
    res.status(503).json({ error: "IB not connected", providers: [] });
    return;
  }
  res.json({ providers: getIBNewsProviders() });
});

router.get("/news/live", (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  res.json({ news: getIBLiveNews(limit) });
});

router.get("/news/historical", async (req: Request, res: Response) => {
  if (!isIBConnected()) {
    res.status(503).json({ error: "IB not connected", news: [] });
    return;
  }
  const conId = Number(req.query["conId"] ?? 0);
  const providers = (req.query["providers"] as string) || "";
  const maxResults = Math.min(Number(req.query["max"] ?? 30), 100);

  if (!conId || !providers) {
    res.status(400).json({ error: "conId and providers are required", news: [] });
    return;
  }

  try {
    const news = await fetchIBHistoricalNews(conId, providers, maxResults);
    res.json({ news });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch news", news: [] });
  }
});

router.get("/news/article", async (req: Request, res: Response) => {
  if (!isIBConnected()) {
    res.status(503).json({ error: "IB not connected" });
    return;
  }
  const providerCode = req.query["provider"] as string;
  const articleId = req.query["articleId"] as string;

  if (!providerCode || !articleId) {
    res.status(400).json({ error: "provider and articleId are required" });
    return;
  }

  try {
    const article = await fetchIBNewsArticle(providerCode, articleId);
    res.json(article);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch article" });
  }
});

router.get("/news/symbol", async (req: Request, res: Response) => {
  if (!isIBConnected()) {
    res.status(503).json({ error: "IB not connected", news: [] });
    return;
  }
  const symbol = (req.query["symbol"] as string) || "";
  if (!symbol) {
    res.status(400).json({ error: "symbol is required", news: [] });
    return;
  }
  const max = Math.min(Number(req.query["max"] ?? 30), 100);
  try {
    const news = await fetchNewsForSymbol(symbol, max);
    res.json({ news });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Failed to fetch news", news: [] });
  }
});

export default router;
