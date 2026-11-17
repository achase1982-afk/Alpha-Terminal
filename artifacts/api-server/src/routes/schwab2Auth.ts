import { getAuth } from "@clerk/express";
import { Router, type IRouter } from "express";
import {
  buildSchwab2AuthorizeUrl,
  deskSchwab2Configured,
  getSchwab2RedirectUri,
  schwab2ExpectedCallbackPath,
} from "../lib/desk/deskSchwab2OAuth.js";

const router: IRouter = Router();

/** JSON URL for clients that fetch the authorize link (Clerk session required). */
router.get("/schwab2-url", (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId && process.env.DEV_BYPASS_AUTH !== "true") {
    return res.status(401).json({ error: "unauthorized" });
  }
  const redirectUri = getSchwab2RedirectUri();
  if (!deskSchwab2Configured() || !redirectUri) {
    return res.json({
      url: "",
      configured: false,
      redirectUri,
      expectedCallbackPath: schwab2ExpectedCallbackPath(),
    });
  }
  const built = buildSchwab2AuthorizeUrl();
  return res.json({
    url: built?.url ?? "",
    configured: Boolean(built?.url),
    redirectUri: built?.redirectUri ?? redirectUri,
    expectedCallbackPath: schwab2ExpectedCallbackPath(),
  });
});

/**
 * Clerk-gated entry: open in browser while signed in to start app-2-only OAuth.
 * Example: https://alpha-terminal-production-f297.up.railway.app/api/auth/schwab2/connect
 */
router.get("/schwab2/connect", (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId && process.env.DEV_BYPASS_AUTH !== "true") {
    return res.status(401).json({ error: "unauthorized" });
  }
  const built = buildSchwab2AuthorizeUrl();
  if (!built) {
    return res.status(503).json({
      error: "not_configured",
      redirectUri: getSchwab2RedirectUri(),
      expectedCallbackPath: schwab2ExpectedCallbackPath(),
    });
  }
  return res.redirect(built.url);
});

router.get("/schwab2/redirect-uri", (_req, res) => {
  const redirectUri = getSchwab2RedirectUri();
  return res.json({
    redirectUri,
    expectedCallbackPath: schwab2ExpectedCallbackPath(),
    configured: deskSchwab2Configured() && Boolean(redirectUri),
    note: "App 2 reuses the app 1 trader-callback URL; OAuth state prefix schwab2_ selects app 2.",
  });
});

/** Legacy alias — forwards to trader-callback via state. */
router.get("/schwab2-callback", (req, res) => {
  const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(307, `/api/auth/trader-callback${q}`);
});

export default router;
