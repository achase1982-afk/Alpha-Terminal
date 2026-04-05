import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, requireAuth } from "@clerk/express";
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("etag");
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

if (DEV_BYPASS) {
  logger.warn("DEV_BYPASS_AUTH is ON — all Clerk auth checks are disabled");
} else {
  app.use(clerkMiddleware());
}

app.use("/api", healthRouter);
if (DEV_BYPASS) {
  app.use("/api", router);
} else {
  app.use("/api", requireAuth(), router);
}

export default app;
