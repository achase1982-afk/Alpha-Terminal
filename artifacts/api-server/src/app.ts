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
  "/snapshot/admin/backfill-iv-history",
]);

const PUBLIC_API_PREFIXES = [
  "/snapshot/admin/backfill-iv-history/",
  "/snapshot/admin/diagnose-list-contracts",
  "/snapshot/admin/backfill-hv-proxy",
  "/snapshot/admin/canonical-iv-accumulate",
];

function apiRequireAuth(req: Request, res: Response, next: NextFunction) {
  // req.path is relative to the mount point ("/api"), so it starts with "/auth/...".
  if (PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }
  for (const prefix of PUBLIC_API_PREFIXES) {
    if (req.path.startsWith(prefix)) return next();
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

// Routes that must NEVER run through clerkMiddleware. Beyond just being
// publicly reachable, these are top-level browser redirects from third-party
// domains (schwab.com OAuth callbacks). clerkMiddleware unconditionally runs
// its handshake protocol on every request — and the handshake issues 307
// redirects to Clerk's FAPI server which re-issue the user's session cookies.
// On the OAuth callback that round trip can drop or invalidate the existing
// Clerk session (especially in iOS in-app browsers, where cookies set during
// the bounce don't survive ITP), causing the user to be bounced back to the
// sign-in page after a successful Schwab link — the "Schwab → Clerk login
// loop" symptom. CSRF on these routes is already enforced via the signed
// `state` query parameter.
const CLERK_BYPASS_PATHS = new Set<string>([
  "/api/auth/callback",
  "/api/auth/trader-callback",
]);

if (DEV_BYPASS) {
  logger.warn("DEV_BYPASS_AUTH is ON — all Clerk auth checks are disabled");
} else {
  const clerk = clerkMiddleware();
  app.use((req, res, next) => {
    if (CLERK_BYPASS_PATHS.has(req.path)) {
      return next();
    }
    return clerk(req, res, next);
  });
}

app.use("/api", healthRouter);
if (DEV_BYPASS) {
  app.use("/api", router);
} else {
  app.use("/api", apiRequireAuth, router);
}

export default app;
