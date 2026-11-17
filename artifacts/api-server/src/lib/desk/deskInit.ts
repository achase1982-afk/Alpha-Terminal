import { getUwApiKey } from "./deskUnusualWhales.js";
import { getTradierToken } from "./deskTradier.js";
import { getAlpacaKeys } from "./deskAlpaca.js";
import { deskProbeAlpacaNews } from "./deskAlpacaNews.js";
import { deskMarkFeedNotConfigured, deskSetStreamerDisabled } from "./deskFeedFreshness.js";
import { startDeskRetentionJobs } from "./deskRetention.js";
import { startDeskBackgroundPollers } from "./deskBackgroundPollers.js";
import { startDeskRawTapeCapture } from "./deskSpxTapeRaw.js";
import { startDeskTapeUniverse } from "./deskTapeUniverse.js";
import { initDeskSchwab2RestFeed } from "./deskSchwab2Rest.js";
import { initDeskTradierSandboxFeed } from "./deskTradierSandbox.js";
import { deskProbeAlpacaPaper } from "./deskAlpacaPaper.js";
import { deskProbeTastytrade } from "./deskTastytrade.js";
import { deskProbeAlphaVantage } from "./deskAlphaVantage.js";
import { deskProbeMarketaux } from "./deskMarketaux.js";
import { deskProbeStocknews } from "./deskStocknews.js";
import { deskProbeEodhd } from "./deskEodhd.js";
import { getAlpacaPaperKeys } from "./deskAlpacaPaper.js";
import { tastytradeConfigured } from "./deskTastytrade.js";
import { getAlphaVantageKey } from "./deskAlphaVantage.js";
import { getMarketauxKey } from "./deskMarketaux.js";
import { getStocknewsKey } from "./deskStocknews.js";
import { getEodhdKey } from "./deskEodhd.js";

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

  const paper = getAlpacaPaperKeys();
  if (!paper.keyId || !paper.secret) {
    deskMarkFeedNotConfigured("alpaca_paper", "alpaca_paper");
  } else {
    void deskProbeAlpacaPaper();
  }

  if (!tastytradeConfigured()) deskMarkFeedNotConfigured("tastytrade", "tastytrade_dxlink");
  else void deskProbeTastytrade();

  initDeskSchwab2RestFeed();
  initDeskTradierSandboxFeed();

  if (!getAlphaVantageKey()) deskMarkFeedNotConfigured("alphavantage", "alphavantage");
  else void deskProbeAlphaVantage();

  if (!getMarketauxKey()) deskMarkFeedNotConfigured("marketaux", "marketaux");
  else void deskProbeMarketaux();

  if (!getStocknewsKey()) deskMarkFeedNotConfigured("stocknews", "stocknews");
  else void deskProbeStocknews();

  if (!getEodhdKey()) deskMarkFeedNotConfigured("eodhd", "eodhd");
  else void deskProbeEodhd();

  startDeskRawTapeCapture();
  startDeskTapeUniverse();
  startDeskBackgroundPollers();
  startDeskRetentionJobs();
}