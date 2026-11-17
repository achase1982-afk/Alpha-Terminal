import { getUwApiKey } from "./deskUnusualWhales.js";
import { getTradierToken } from "./deskTradier.js";
import { getAlpacaKeys } from "./deskAlpaca.js";
import { deskMarkFeedNotConfigured, deskSetStreamerDisabled } from "./deskFeedFreshness.js";
import { initDeskStreamerSymbols } from "./deskStreamerTap.js";
import { startDeskRetentionJobs } from "./deskRetention.js";

/** Desk feed registry bootstrap (optional providers + streamer symbol subs). */
export function initDeskMarketFeeds(): void {
  const streamerOff =
    process.env.DISABLE_SCHWAB_STREAMER === "1" || process.env.DISABLE_SCHWAB_STREAMER === "true";
  const deskStreamer = process.env.DESK_STREAMER_ENABLED === "true";
  deskSetStreamerDisabled(streamerOff && !deskStreamer);

  if (!getUwApiKey()) deskMarkFeedNotConfigured("uw_flow");
  if (!getTradierToken()) deskMarkFeedNotConfigured("tradier");
  const { keyId, secret } = getAlpacaKeys();
  if (!keyId || !secret) deskMarkFeedNotConfigured("alpaca");

  initDeskStreamerSymbols();
  startDeskRetentionJobs();
}