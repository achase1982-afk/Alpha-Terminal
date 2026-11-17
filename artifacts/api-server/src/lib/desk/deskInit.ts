import { getUwApiKey } from "./deskUnusualWhales.js";
import { getTradierToken } from "./deskTradier.js";
import { getAlpacaKeys } from "./deskAlpaca.js";
import { deskProbeAlpacaNews } from "./deskAlpacaNews.js";
import { deskMarkFeedNotConfigured, deskSetStreamerDisabled } from "./deskFeedFreshness.js";
import { startDeskRetentionJobs } from "./deskRetention.js";
import { startDeskBackgroundPollers } from "./deskBackgroundPollers.js";
import { startDeskRawTapeCapture } from "./deskSpxTapeRaw.js";
import { startDeskTapeUniverse } from "./deskTapeUniverse.js";

/** Desk feed registry bootstrap (optional providers + streamer symbol subs). */
export function initDeskMarketFeeds(): void {
  const streamerOff =
    process.env.DISABLE_SCHWAB_STREAMER === "1" || process.env.DISABLE_SCHWAB_STREAMER === "true";
  const deskStreamer = process.env.DESK_STREAMER_ENABLED === "true";
  deskSetStreamerDisabled(streamerOff && !deskStreamer);

  if (!getUwApiKey()) {
    deskMarkFeedNotConfigured("uw_flow", "unusual_whales");
    deskMarkFeedNotConfigured("live_gamma_0dte", "unusual_whales");
    deskMarkFeedNotConfigured("live_gamma", "unusual_whales");
    deskMarkFeedNotConfigured("live_net_prem", "unusual_whales");
  }
  if (!getTradierToken()) deskMarkFeedNotConfigured("tradier");
  const { keyId, secret } = getAlpacaKeys();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca", "alpaca_news");
  } else {
    void deskProbeAlpacaNews();
  }

  startDeskRawTapeCapture();
  startDeskTapeUniverse();
  startDeskBackgroundPollers();
  startDeskRetentionJobs();
}