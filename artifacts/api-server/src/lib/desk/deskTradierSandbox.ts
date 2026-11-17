import { deskEnv } from "./deskEnv.js";
import { deskMarkFeedConfiguredKeys, deskMarkFeedNotConfigured } from "./deskFeedFreshness.js";

const SOURCE = "tradier_sandbox";

export function getTradierSandboxToken(): string {
  return deskEnv("TRADIER_SANDBOX_TOKEN");
}

/** Keys stored for future use; no trading or quote endpoints on desk API. */
export function initDeskTradierSandboxFeed(): void {
  const tok = getTradierSandboxToken();
  if (!tok) deskMarkFeedNotConfigured("tradier_sandbox", SOURCE);
  else deskMarkFeedConfiguredKeys("tradier_sandbox", SOURCE);
}