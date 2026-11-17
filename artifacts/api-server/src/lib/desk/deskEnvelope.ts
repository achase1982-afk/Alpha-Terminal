import { deskAsofEtIso, deskSessionDateEt } from "./deskEt.js";
import {
  deskFeedEnvelopeStale,
  deskIsFeedStale,
  type DeskFeedId,
} from "./deskFeedFreshness.js";

export type DeskEnvelope<T> = T & {
  source: string;
  as_of: number;
  stale: boolean;
  session_date: string;
  asof_et: string;
};

export function deskEnvelope<T extends Record<string, unknown>>(
  payload: T,
  source: string,
  asOfMs: number,
  feed?: DeskFeedId,
): DeskEnvelope<T> {
  const stale = feed
    ? deskFeedEnvelopeStale(feed) || deskIsFeedStale(feed, asOfMs)
    : false;
  return {
    ...payload,
    source,
    as_of: asOfMs,
    stale,
    session_date: deskSessionDateEt(new Date(asOfMs)),
    asof_et: deskAsofEtIso(new Date(asOfMs)),
  };
}
