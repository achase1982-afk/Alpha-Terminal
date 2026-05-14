import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, terminalWatchlistsTable } from "@workspace/db";
import { eq } from "@workspace/db";
import { logger } from "../lib/logger.js";

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user_local";

function getUserId(req: any): string {
  if (DEV_BYPASS) return DEV_USER_ID;
  try {
    const auth = getAuth(req);
    return auth?.userId ?? DEV_USER_ID;
  } catch {
    return DEV_USER_ID;
  }
}

const router: IRouter = Router();

router.get("/terminal", async (req, res) => {
  try {
    const userId = getUserId(req);
    const rows = await db
      .select()
      .from(terminalWatchlistsTable)
      .where(eq(terminalWatchlistsTable.userId, userId));

    const watchlists: Record<string, { name: string; symbols: string[] }> = {};
    for (const row of rows) {
      watchlists[row.clientId] = { name: row.name, symbols: row.symbols };
    }
    res.json({ watchlists });
  } catch (err: any) {
    logger.error({ err: err.message }, "GET /watchlists/terminal failed");
    res.status(500).json({ error: err.message });
  }
});

router.put("/terminal", async (req, res) => {
  try {
    const userId = getUserId(req);
    const { watchlists } = req.body as {
      watchlists: Record<string, { name: string; symbols: string[] }>;
    };

    if (!watchlists || typeof watchlists !== "object") {
      res.status(400).json({ error: "watchlists must be an object" });
      return;
    }

    const entries = Object.entries(watchlists).map(([clientId, wl]) => ({
      userId,
      clientId,
      name: String(wl.name ?? "Watchlist"),
      symbols: Array.isArray(wl.symbols) ? wl.symbols.map(String) : [],
    }));

    await db.transaction(async (tx) => {
      await tx
        .delete(terminalWatchlistsTable)
        .where(eq(terminalWatchlistsTable.userId, userId));
      if (entries.length > 0) {
        await tx.insert(terminalWatchlistsTable).values(entries);
      }
    });

    res.json({ ok: true, count: entries.length });
  } catch (err: any) {
    logger.error({ err: err.message }, "PUT /watchlists/terminal failed");
    res.status(500).json({ error: err.message });
  }
});

export default router;
