import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, terminalDashboardLayoutsTable } from "@workspace/db";
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

interface LayoutItemBody {
  i: string;
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pinnedSymbol?: string | null;
  chartPeriod?: string | null;
  chartInterval?: string | null;
}

function sanitizeItems(raw: unknown): LayoutItemBody[] | null {
  if (!Array.isArray(raw)) return null;
  const items: LayoutItemBody[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") return null;
    const { i, widgetId, x, y, w, h, pinnedSymbol, chartPeriod, chartInterval } = it as Record<
      string,
      unknown
    >;
    if (typeof i !== "string" || typeof widgetId !== "string") return null;
    if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    items.push({
      i,
      widgetId,
      x: x as number,
      y: y as number,
      w: w as number,
      h: h as number,
      pinnedSymbol:
        typeof pinnedSymbol === "string" && pinnedSymbol.length > 0 && pinnedSymbol.length <= 24
          ? pinnedSymbol
          : null,
      chartPeriod:
        typeof chartPeriod === "string" && chartPeriod.length > 0 && chartPeriod.length <= 8
          ? chartPeriod
          : null,
      chartInterval:
        typeof chartInterval === "string" && chartInterval.length > 0 && chartInterval.length <= 8
          ? chartInterval
          : null,
    });
  }
  return items;
}

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const rows = await db
      .select()
      .from(terminalDashboardLayoutsTable)
      .where(eq(terminalDashboardLayoutsTable.userId, userId));
    const row = rows[0];
    res.json({
      items: row?.items ?? null,
      activePreset: row?.activePreset ?? null,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "GET /dashboard-layout failed");
    res.status(500).json({ error: err.message });
  }
});

router.put("/", async (req, res) => {
  try {
    const userId = getUserId(req);
    const body = req.body as { items?: unknown; activePreset?: unknown };
    const items = sanitizeItems(body.items);
    if (!items) {
      res.status(400).json({ error: "items must be an array of layout entries" });
      return;
    }
    const activePreset =
      typeof body.activePreset === "string" && body.activePreset.length > 0
        ? body.activePreset
        : null;

    await db
      .insert(terminalDashboardLayoutsTable)
      .values({ userId, items, activePreset, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: terminalDashboardLayoutsTable.userId,
        set: { items, activePreset, updatedAt: new Date() },
      });

    res.json({ ok: true, count: items.length });
  } catch (err: any) {
    logger.error({ err: err.message }, "PUT /dashboard-layout failed");
    res.status(500).json({ error: err.message });
  }
});

export default router;
