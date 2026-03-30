import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const isDev = process.env.NODE_ENV !== "production";

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

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: isDev ? false : { maxAge: 31536000, includeSubDomains: true },
  }),
);

const allowedOrigins = isDev
  ? true
  : [
      ...(process.env.REPLIT_DEV_DOMAIN ? [`https://${process.env.REPLIT_DEV_DOMAIN}`] : []),
      ...(process.env.REPLIT_DOMAINS
        ? process.env.REPLIT_DOMAINS.split(",").map(d => `https://${d.trim()}`)
        : []),
    ].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 86400,
  }),
);

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many requests, please try again later" },
  skip: (req: Request) => req.path === "/healthz" || req.path === "/stream/snapshot",
});
app.use("/api", apiLimiter);

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many auth requests" },
});
app.use("/api/auth", authLimiter);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err.message }, "Unhandled error");
  res.status(500).json({ error: "internal_error", message: isDev ? err.message : "An unexpected error occurred" });
});

export default app;
