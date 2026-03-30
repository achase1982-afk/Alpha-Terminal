import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";

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
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const isDev = process.env.NODE_ENV !== "production";

if (!isDev) {
  app.use(clerkMiddleware());
}

app.use("/api", healthRouter);

function apiRequireAuth(req: Request, res: Response, next: NextFunction) {
  if (isDev) {
    next();
    return;
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.use("/api", apiRequireAuth, router);

export default app;
