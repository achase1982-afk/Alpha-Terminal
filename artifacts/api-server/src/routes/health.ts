import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/debug-redirect", (_req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.json({
    isProd,
    nodeEnv: process.env.NODE_ENV || "(not set)",
    marketRedirectUri: (isProd ? process.env.SCHWAB_REDIRECT_URI_PROD : process.env.SCHWAB_REDIRECT_URI) || "(empty)",
    traderRedirectUri: (isProd ? process.env.SCHWAB_TRADER_REDIRECT_URI_PROD : process.env.SCHWAB_TRADER_REDIRECT_URI) || "(empty)",
  });
});

export default router;
