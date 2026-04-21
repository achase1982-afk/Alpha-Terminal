import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";

// OAuth callback endpoints must be publicly reachable — they're hit by the
// browser as a top-level redirect from a third-party domain (schwab.com) and
// already have their own CSRF protection via the signed `state` query param.
// Requiring a Clerk session here would always 401 the user mid-OAuth.
const PUBLIC_API_PATHS = new Set<string>([
  "/auth/callback",
  "/auth/trader-callback",
  "/auth/redirect-uri",
  "/auth/url",
  "/auth/trader-url",
  "/auth/pending-session",
  "/auth/trader-pending-session",
  // Admin maintenance endpoints — protected by x-admin-key header instead of Clerk session
  "/snapshot/admin/cleanup-iv-units",
  "/snapshot/admin/recompute-ivr",
]);

function apiRequireAuth(req: Request, res: Response, next: NextFunction) {
  // req.path is relative to the mount point ("/api"), so it starts with "/auth/...".
  if (PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

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
  app.use("/api", apiRequireAuth, router);
}

export default app;
