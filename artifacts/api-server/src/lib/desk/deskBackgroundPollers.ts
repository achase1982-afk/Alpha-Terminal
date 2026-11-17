import { deskFetchSchwabChain } from "./deskSchwabChains.js";
import { deskTradierQuotes, getTradierToken } from "./deskTradier.js";
import { deskProbeAlpacaNews } from "./deskAlpacaNews.js";
import { deskFetchNews } from "./deskNews.js";
import { deskProbeMarketaux } from "./deskMarketaux.js";
import { deskProbeStocknews } from "./deskStocknews.js";
import { deskProbeEodhd } from "./deskEodhd.js";
import { getMarketauxKey } from "./deskMarketaux.js";
import { getStocknewsKey } from "./deskStocknews.js";
import { getEodhdKey } from "./deskEodhd.js";
import { tastytradeConfigured, deskProbeTastytrade } from "./deskTastytrade.js";
import { getAlpacaPaperKeys, deskProbeAlpacaPaper } from "./deskAlpacaPaper.js";
import { deskSessionDateEt } from "./deskEt.js";
import { logger } from "../logger.js";
import { DESK_NEWS_POLL_MS } from "./deskPollCadence.js";

const POLL_MS = DESK_NEWS_POLL_MS;
const CHAINS_POLL_MS = 120_000;
const VENDOR_SLOW_MS = 15 * 60_000;

let pollInFlight: Promise<void> | null = null;

export async function pollDeskChains(): Promise<void> {
  const expiry = deskSessionDateEt();
  await deskFetchSchwabChain("SPX", expiry);
}

async function pollTradier(): Promise<void> {
  if (!getTradierToken()) return;
  await deskTradierQuotes(["SPY", "QQQ"]);
}

async function pollAlpacaNews(): Promise<void> {
  await deskProbeAlpacaNews();
}

async function pollNews(): Promise<void> {
  const { DESK_DEFAULT_NEWS_SYMBOLS } = await import("./deskDefaultNewsSymbols.js");
  await deskFetchNews([...DESK_DEFAULT_NEWS_SYMBOLS]);
}

async function pollVendorSlow(): Promise<void> {
  const paper = getAlpacaPaperKeys();
  if (paper.keyId && paper.secret) await deskProbeAlpacaPaper();
  if (tastytradeConfigured()) await deskProbeTastytrade();
  if (getMarketauxKey()) await deskProbeMarketaux();
  if (getStocknewsKey()) await deskProbeStocknews();
  if (getEodhdKey()) await deskProbeEodhd();
}

export async function runDeskBackgroundPollCycle(): Promise<void> {
  if (pollInFlight) {
    await pollInFlight;
    return;
  }

  pollInFlight = (async () => {
    try {
      await pollDeskChains();
      await pollTradier();
      await pollAlpacaNews();
      await pollNews();
    } catch (err) {
      logger.debug({ err }, "Desk background poll cycle error");
    }
  })().finally(() => {
    pollInFlight = null;
  });

  await pollInFlight;
}

export function startDeskBackgroundPollers(): void {
  void runDeskBackgroundPollCycle();
  const t = setInterval(() => {
    void runDeskBackgroundPollCycle();
  }, POLL_MS);
  t.unref?.();

  void pollDeskChains();
  const chainsTimer = setInterval(() => {
    void pollDeskChains();
  }, CHAINS_POLL_MS);
  chainsTimer.unref?.();

  void pollVendorSlow();
  const vendorTimer = setInterval(() => {
    void pollVendorSlow();
  }, VENDOR_SLOW_MS);
  vendorTimer.unref?.();
}
