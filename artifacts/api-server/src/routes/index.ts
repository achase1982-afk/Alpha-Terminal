import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import marketRouter from "./market";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/market", marketRouter);
router.use("/ai", aiRouter);

export default router;
