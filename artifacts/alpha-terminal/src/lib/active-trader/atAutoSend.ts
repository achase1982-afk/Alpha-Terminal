import type { ActiveTraderTemplatePrefs } from "./activeTraderPrefs";
import { atOrderSendAllowed } from "./atOrderSend";

export interface AtAutoSendPrefs {
  /** User opted in via Auto send checkbox (default off). */
  enabled: boolean;
  /** Session arm — required in addition to enabled before any live submit. */
  armed: boolean;
}

export interface AtAutoSendContext {
  accountHash: string | null;
  /** Fixture / screenshot harness — never place orders. */
  blockLiveSend: boolean;
  /** Non-null when bracket leg validation fails. */
  orderValidationError: string | null;
  entryPrice: number | null;
}

export const DEFAULT_AUTO_SEND: AtAutoSendPrefs = {
  enabled: false,
  armed: false,
};

export function canArmAutoSend(ctx: Pick<AtAutoSendContext, "accountHash" | "blockLiveSend" | "orderValidationError" | "entryPrice">): string | null {
  if (ctx.blockLiveSend) return "Disabled in preview / fixture mode";
  if (!ctx.accountHash) return "Link a Schwab account to arm";
  if (ctx.entryPrice == null || ctx.entryPrice <= 0) return "Select a strike with a live quote";
  if (ctx.orderValidationError) return ctx.orderValidationError;
  return null;
}

export function isAutoSendLiveReady(prefs: ActiveTraderTemplatePrefs, ctx: AtAutoSendContext): boolean {
  if (!atOrderSendAllowed()) return false;
  if (!prefs.autoSend.enabled || !prefs.autoSend.armed) return false;
  if (ctx.blockLiveSend) return false;
  if (!ctx.accountHash) return false;
  if (ctx.entryPrice == null || ctx.entryPrice <= 0) return false;
  if (ctx.orderValidationError) return false;
  return true;
}

/** Turning off Auto send always disarms. */
export function patchAutoSendEnabled(prefs: ActiveTraderTemplatePrefs, enabled: boolean): ActiveTraderTemplatePrefs {
  return {
    ...prefs,
    autoSend: { enabled, armed: enabled ? prefs.autoSend.armed : false },
  };
}

export function patchAutoSendArmed(prefs: ActiveTraderTemplatePrefs, armed: boolean): ActiveTraderTemplatePrefs {
  return {
    ...prefs,
    autoSend: { ...prefs.autoSend, armed: armed && prefs.autoSend.enabled },
  };
}