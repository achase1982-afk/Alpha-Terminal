import { Router, type IRouter } from "express";
import authRouter from "./auth";
import marketRouter from "./market";
import aiRouter from "./ai";
import streamRouter from "./stream";
import portfolioRouter from "./portfolio";
import ibRouter from "./ib";
import economicRouter from "./economic";
import secRouter from "./sec";
const router: IRouter = Router();

router.use("/auth", authRouter);
router.use("/market", marketRouter);
router.use("/ai", aiRouter);
router.use("/stream", streamRouter);
router.use("/portfolio", portfolioRouter);
router.use("/ib", ibRouter);
router.use("/economic", economicRouter);
router.use("/sec", secRouter);

export default router;
