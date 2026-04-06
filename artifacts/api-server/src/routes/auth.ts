import { Router, type IRouter } from "express";
import {
  GetAuthStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/url", (_req, res) => {
  res.json({ url: "", configured: false });
});

router.get("/status", (_req, res) => {
  const claudeConfigured = !!process.env.ANTHROPIC_API_KEY;
  res.json(GetAuthStatusResponse.parse({ configured: false, claudeConfigured }));
});

router.get("/server-tokens", (_req, res) => {
  res.json({ market: null, trader: null });
});

router.get("/pending-session", (_req, res) => {
  res.json({ found: false });
});

router.get("/trader-pending-session", (_req, res) => {
  res.json({ found: false });
});

router.post("/disconnect", (_req, res) => {
  res.json({ ok: true });
});

export default router;
