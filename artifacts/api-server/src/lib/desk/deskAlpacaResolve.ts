import { getAlpacaKeys } from "./deskAlpaca.js";
import { getAlpacaPaperKeys } from "./deskAlpacaPaper.js";
import type { DeskFeedId } from "./deskFeedFreshness.js";

export function resolveDeskAlpacaMarketKeys(): {
  keyId: string;
  secret: string;
  feedId: DeskFeedId;
  source: string;
} {
  const paper = getAlpacaPaperKeys();
  if (paper.keyId && paper.secret) {
    return { ...paper, feedId: "alpaca_paper", source: "alpaca_paper" };
  }
  const live = getAlpacaKeys();
  return { ...live, feedId: "alpaca", source: "alpaca" };
}