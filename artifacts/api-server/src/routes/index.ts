import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import marketRouter from "./market";
import aiRouter from "./ai";
import streamRouter from "./stream";
import { aiRateLimiter, requireInternalOrigin, validateSymbolParam } from "../lib/security.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/market", validateSymbolParam, marketRouter);
router.use("/ai", aiRateLimiter, requireInternalOrigin, aiRouter);
router.use("/stream", streamRouter);

export default router;
