import { getAuth } from "@clerk/express";
import type { Request } from "express";
import { db, eq, sql, terminalPortfolioPrefsTable } from "@workspace/db";
import { logger } from "./logger.js";

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user_local";

let tableReady = false;

export function portfolioPrefsUserId(req: Request): string {
  if (DEV_BYPASS) return DEV_USER_ID;
  try {
    const auth = getAuth(req);
    return auth?.userId ?? DEV_USER_ID;
  } catch {
    return DEV_USER_ID;
  }
}

async function ensurePrefsTable() {
  if (tableReady) return;
  await db.execute(sql`
    create table if not exists terminal_portfolio_prefs (
      user_id text primary key,
      view_selection text not null default 'all',
      default_trading_account_hash text,
      hide_balances boolean not null default false,
      updated_at timestamp not null default now()
    )
  `);
  tableReady = true;
}

export interface PortfolioPrefsPayload {
  viewSelection: string;
  defaultTradingAccountHash: string | null;
  hideBalances: boolean;
}

const DEFAULT_PREFS: PortfolioPrefsPayload = {
  viewSelection: "all",
  defaultTradingAccountHash: null,
  hideBalances: false,
};

export async function getPortfolioPrefs(userId: string): Promise<PortfolioPrefsPayload> {
  await ensurePrefsTable();
  try {
    const rows = await db
      .select()
      .from(terminalPortfolioPrefsTable)
      .where(eq(terminalPortfolioPrefsTable.userId, userId))
      .limit(1);
    const row = rows[0];
    if (!row) return { ...DEFAULT_PREFS };
    return {
      viewSelection: row.viewSelection || "all",
      defaultTradingAccountHash: row.defaultTradingAccountHash ?? null,
      hideBalances: row.hideBalances ?? false,
    };
  } catch (err) {
    logger.warn({ err, userId }, "getPortfolioPrefs failed");
    return { ...DEFAULT_PREFS };
  }
}

export async function savePortfolioPrefs(
  userId: string,
  patch: Partial<PortfolioPrefsPayload>,
): Promise<PortfolioPrefsPayload> {
  await ensurePrefsTable();
  const current = await getPortfolioPrefs(userId);
  const next: PortfolioPrefsPayload = {
    viewSelection:
      typeof patch.viewSelection === "string" && patch.viewSelection.trim()
        ? patch.viewSelection.trim()
        : current.viewSelection,
    defaultTradingAccountHash:
      patch.defaultTradingAccountHash !== undefined
        ? patch.defaultTradingAccountHash
        : current.defaultTradingAccountHash,
    hideBalances:
      typeof patch.hideBalances === "boolean" ? patch.hideBalances : current.hideBalances,
  };

  await db
    .insert(terminalPortfolioPrefsTable)
    .values({
      userId,
      viewSelection: next.viewSelection,
      defaultTradingAccountHash: next.defaultTradingAccountHash,
      hideBalances: next.hideBalances,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: terminalPortfolioPrefsTable.userId,
      set: {
        viewSelection: next.viewSelection,
        defaultTradingAccountHash: next.defaultTradingAccountHash,
        hideBalances: next.hideBalances,
        updatedAt: new Date(),
      },
    });

  return next;
}
