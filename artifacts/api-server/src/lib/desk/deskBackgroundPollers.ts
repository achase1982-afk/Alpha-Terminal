import { deskFetchSchwabChain } from "./deskSchwabChains.js";
import { deskFetchUwFlow } from "./deskUnusualWhales.js";
import { deskTradierQuotes, getTradierToken } from "./deskTradier.js";
import { deskAlpacaQuotes, getAlpacaKeys } from "./deskAlpaca.js";
import { deskFetchNews } from "./deskNews.js";
import { refreshDeskUwLiveFeeds } from "./deskUwLiveFeeds.js";
import { deskSessionDateEt } from "./deskEt.js";
import { logger } from "../logger.js";

const POLL_MS = 90_000;

let pollInFlight: Promise<void> | null = null;

async function pollChains(): Promise<void> {
  const expiry = deskSessionDateEt();
  await deskFetchSchwabChain("SPX", expiry);
}

async function pollTradier(): Promise<void> {
  if (!getTradierToken()) return;
  await deskTradierQuotes(["SPY", "QQQ"]);
}

async function pollAlpaca(): Promise<void> {
  const { keyId, secret } = getAlpacaKeys();
  if (!keyId || !secret) return;
  await deskAlpacaQuotes(["SPY"]);
}

async function pollNews(): Promise<void> {
  await deskFetchNews(["SPY", "QQQ"]);
}

/** UW calls are serialized via deskUwHttp / flow semaphores (max 3 in flight globally). */
export async function runDeskBackgroundPollCycle(): Promise<void> {
  if (pollInFlight) {
    await pollInFlight;
    return;
  }

  pollInFlight = (async () => {
    try {
      await refreshDeskUwLiveFeeds(true);
      await deskFetchUwFlow();
      await pollChains();
      await pollTradier();
      await pollAlpaca();
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
}