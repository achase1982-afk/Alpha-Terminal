import { logger } from "../logger.js";

export type WebullTokenStatus = "PENDING" | "NORMAL" | "INVALID" | "EXPIRED" | "NONE";

export interface StoredWebullToken {
  accessToken: string;
  expiresAt: number;
  status: WebullTokenStatus;
}

let memory: StoredWebullToken | null = null;
let dbReady = false;

export function webullCredentialsConfigured(): boolean {
  return !!(process.env.WEBULL_APP_KEY?.trim() && process.env.WEBULL_APP_SECRET?.trim());
}

export function webullAppKey(): string {
  return process.env.WEBULL_APP_KEY?.trim() ?? "";
}

export function webullAppSecret(): string {
  return process.env.WEBULL_APP_SECRET?.trim() ?? "";
}

async function ensureDb(): Promise<boolean> {
  if (dbReady) return true;
  try {
    const { db, sql } = await import("@workspace/db");
    await db.execute(sql`
      create table if not exists webull_tokens (
        id text primary key,
        access_token text not null,
        expires_at bigint not null,
        status text not null,
        updated_at timestamp not null default now()
      )
    `);
    dbReady = true;
    return true;
  } catch (err) {
    logger.warn({ err }, "Webull token store: DB unavailable");
    return false;
  }
}

export async function loadWebullTokenFromDb(): Promise<StoredWebullToken | null> {
  if (!(await ensureDb())) return memory;
  try {
    const { db, sql } = await import("@workspace/db");
    const result = await db.execute(sql`
      select access_token, expires_at, status
      from webull_tokens
      where id = 'default'
      limit 1
    `);
    const row = ((result as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0];
    if (!row) return null;
    const accessToken = typeof row.access_token === "string" ? row.access_token : "";
    const expiresAt = Number(row.expires_at);
    const status = typeof row.status === "string" ? (row.status as WebullTokenStatus) : "NONE";
    if (!accessToken || !Number.isFinite(expiresAt)) return null;
    const stored = { accessToken, expiresAt, status };
    memory = stored;
    return stored;
  } catch (err) {
    logger.warn({ err }, "Webull token store: load failed");
    return memory;
  }
}

export async function persistWebullToken(token: StoredWebullToken): Promise<void> {
  memory = token;
  if (!(await ensureDb())) return;
  try {
    const { db, sql } = await import("@workspace/db");
    await db.execute(sql`
      insert into webull_tokens (id, access_token, expires_at, status, updated_at)
      values ('default', ${token.accessToken}, ${token.expiresAt}, ${token.status}, now())
      on conflict (id) do update set
        access_token = excluded.access_token,
        expires_at = excluded.expires_at,
        status = excluded.status,
        updated_at = now()
    `);
  } catch (err) {
    logger.warn({ err }, "Webull token store: persist failed");
  }
}

export async function clearWebullToken(): Promise<void> {
  memory = null;
  if (!(await ensureDb())) return;
  try {
    const { db, sql } = await import("@workspace/db");
    await db.execute(sql`delete from webull_tokens where id = 'default'`);
  } catch (err) {
    logger.warn({ err }, "Webull token store: clear failed");
  }
}

export async function getWebullToken(): Promise<StoredWebullToken | null> {
  if (memory) return memory;
  return loadWebullTokenFromDb();
}

export function isWebullTradingReady(token: StoredWebullToken | null): token is StoredWebullToken {
  return !!token && token.status === "NORMAL" && token.accessToken.length > 0;
}

export const WEBULL_ACCOUNT_HASH_PREFIX = "webull:";

export function webullAccountHash(accountId: string): string {
  return `${WEBULL_ACCOUNT_HASH_PREFIX}${accountId}`;
}

export function parseWebullAccountHash(hash: string | null | undefined): string | null {
  if (!hash || !hash.startsWith(WEBULL_ACCOUNT_HASH_PREFIX)) return null;
  const id = hash.slice(WEBULL_ACCOUNT_HASH_PREFIX.length).trim();
  return id || null;
}

export function isWebullAccountHash(hash: string | null | undefined): boolean {
  return !!hash?.startsWith(WEBULL_ACCOUNT_HASH_PREFIX);
}