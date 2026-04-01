import { Router, type Request, type Response } from "express";
import {
  connectIB,
  disconnectIB,
  isIBConnected,
  getIBStatus,
  getIBSnapshot,
  getIBSymbolList,
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

export default router;
