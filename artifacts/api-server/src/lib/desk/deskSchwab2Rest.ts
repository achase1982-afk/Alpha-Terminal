import { deskEnv } from "./deskEnv.js";
import { deskMarkFeedNotAuthorized, deskMarkFeedNotConfigured } from "./deskFeedFreshness.js";

const SOURCE = "schwab_rest_2";

/** REST placeholder only — no streamer or OAuth for app key 2 yet. */
export function initDeskSchwab2RestFeed(): void {
  const key = deskEnv("SCHWAB_APP_KEY_2");
  const secret = deskEnv("SCHWAB_APP_SECRET_2");
  if (!key || !secret) {
    deskMarkFeedNotConfigured("schwab2_rest", SOURCE);
    return;
  }
  deskMarkFeedNotAuthorized("schwab2_rest", "schwab_app_key_2_oauth_not_wired", SOURCE);
}