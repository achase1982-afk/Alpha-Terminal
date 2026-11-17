import { Router, type IRouter } from "express";
import {
  buildSchwab2AuthorizeUrl,
  deskSchwab2Configured,
  getSchwab2RedirectUri,
  schwab2ExpectedCallbackPath,
} from "../lib/desk/deskSchwab2OAuth.js";

const router: IRouter = Router();

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return false;
  return req.headers["x-admin-key"] === adminKey;
}

/** Standalone market-data reconnect (app 2 only). */
router.get("/schwab2-url", (_req, res) => {
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

router.get("/schwab2/start", (req, res) => {
  if (!requireAdmin(req)) return res.status(401).json({ error: "unauthorized" });
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

/** Legacy alias — forwards are handled on trader-callback via state. */
router.get("/schwab2-callback", (req, res) => {
  const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(307, `/api/auth/trader-callback${q}`);
});

export default router;