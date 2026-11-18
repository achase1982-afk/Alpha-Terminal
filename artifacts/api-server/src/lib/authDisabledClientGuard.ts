import type { Response } from "express";
import { isAuthDisabled } from "./authMode.js";

export const AUTH_DISABLED_ERROR = "auth_disabled" as const;

export function refuseAuthDisabledClientOp(res: Response): boolean {
  if (!isAuthDisabled()) return false;
  res.status(403).json({ error: AUTH_DISABLED_ERROR });
  return true;
}