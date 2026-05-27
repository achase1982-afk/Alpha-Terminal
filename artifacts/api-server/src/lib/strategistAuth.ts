import { getAuth } from "@clerk/express";
import type { Request } from "express";

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user_local";

/** Authenticated Clerk user id for Strategist V3 routes (401 when missing in production). */
export function requireStrategistUserId(req: Request): string | null {
  if (DEV_BYPASS) return DEV_USER_ID;
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}
