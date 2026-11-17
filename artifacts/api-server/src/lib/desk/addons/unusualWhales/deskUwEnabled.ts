import { getUwApiKey } from "./deskUnusualWhales.js";

/** `DESK_UW_ENABLED`: explicit off (`0`/`false`), on (`1`/`true`), or default on when a UW key is set. */
export function deskUwAddonEnabled(): boolean {
  for (const k of ["DESK_UW_ENABLED", "UW_ENABLED"]) {
    const raw = process.env[k];
    if (raw !== undefined) {
      const v = raw.trim().toLowerCase();
      if (v === "0" || v === "false" || v === "no") return false;
      if (v === "1" || v === "true" || v === "yes") return true;
    }
  }
  return Boolean(getUwApiKey());
}
