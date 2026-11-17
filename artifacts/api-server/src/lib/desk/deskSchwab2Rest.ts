import { deskMarkFeedNotConfigured, deskMarkFeedNotAuthorized } from "./deskFeedFreshness.js";
import { deskSchwab2Configured } from "./deskSchwab2OAuth.js";
import { hasSchwab2Tokens } from "./deskSchwab2TokenStore.js";

const SOURCE = "schwab_rest_2";

export function initDeskSchwab2RestFeed(): void {
  if (!deskSchwab2Configured()) {
    deskMarkFeedNotConfigured("schwab2_rest", SOURCE);
    return;
  }
  if (!hasSchwab2Tokens()) {
    deskMarkFeedNotAuthorized("schwab2_rest", "schwab2_oauth_required", SOURCE);
  }
}
