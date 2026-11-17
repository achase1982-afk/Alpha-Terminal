import { getUwApiKey } from "./deskUnusualWhales.js";
import { getTradierToken } from "./deskTradier.js";
import { getAlpacaKeys } from "./deskAlpaca.js";
import { deskMarkFeedNotConfigured } from "./deskFeedFreshness.js";
import { initDeskSpxTape } from "./deskSpxTape.js";

/** One-time desk feed registry bootstrap (optional providers + SPX tape poller). */
export function initDeskMarketFeeds(): void {
  if (!getUwApiKey()) deskMarkFeedNotConfigured("uw_flow");
  if (!getTradierToken()) deskMarkFeedNotConfigured("tradier");
  const { keyId, secret } = getAlpacaKeys();
  if (!keyId || !secret) deskMarkFeedNotConfigured("alpaca");
  initDeskSpxTape();
}