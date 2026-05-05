import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";

const router: IRouter = Router();

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user";

function requireUserId(req: Parameters<typeof getAuth>[0]): string | null {
  if (DEV_BYPASS) return DEV_USER_ID;
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

/** Layer 1: static LC130 universe — no DB, no external APIs. */
router.get("/v3/universe", (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const tickers = [...LIQUID_CORE_SYMBOL_STRINGS];
  const scan_at = new Date().toISOString();
  return res.json({
    tickers,
    scan_at,
    count: tickers.length,
  });
});

export default router;
