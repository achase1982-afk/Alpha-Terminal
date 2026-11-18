import { logger } from "../logger.js";
import { deskLiveFlowTimesaleDebugEnabled } from "./deskLiveFlowConfig.js";
import { deskSessionDateEt } from "./deskEt.js";
import { deskResolveSpxSpot } from "./deskSpxSpot.js";
import { parseOccExpiryKey, sortOptionKeysNearTheMoney } from "../streamerSubPlanSort.js";
import {
  getDeskAddedLevelOneOptionSymbols,
  deskStreamerAddTimesaleOptions,
  deskStreamerUnsubTimesaleOptions,
} from "../schwabStreamer.js";

const LOG_PREFIX = "DESK_TIMESALE_RAW";
const RING_MAX = 200;

type RawTsFrame = {
  at_ms: number;
  session_date: string;
  service: string;
  kind: "data" | "response";
  content: unknown;
};

const ring: RawTsFrame[] = [];
let subscribedKeys: string[] = [];
let started = false;
let lastConnectionId = -1;

export function deskLiveFlowTimesalePushRaw(service: string, content: unknown): void {
  if (!deskLiveFlowTimesaleDebugEnabled()) return;
  ring.push({ at_ms: Date.now(), session_date: deskSessionDateEt(), service, kind: "data", content });
  if (ring.length > RING_MAX) ring.shift();
  logger.info({ prefix: LOG_PREFIX, at_ms: Date.now(), service }, "Desk TIMESALE_OPTIONS raw frame");
}

export function deskLiveFlowTimesalePushStreamerResponse(service: string, content: unknown): void {
  if (!deskLiveFlowTimesaleDebugEnabled()) return;
  ring.push({ at_ms: Date.now(), session_date: deskSessionDateEt(), service, kind: "response", content });
  if (ring.length > RING_MAX) ring.shift();
}

export function deskLiveFlowTimesaleRecent(limit = 50): RawTsFrame[] {
  const n = Math.min(Math.max(1, limit), RING_MAX);
  return ring.slice(-n);
}

async function pickSpxw0dteNearMoney(count: number): Promise<string[]> {
  const today = deskSessionDateEt().replace(/-/g, "").slice(2);
  const spot = await deskResolveSpxSpot();
  const all = getDeskAddedLevelOneOptionSymbols();
  const zeroDte = all.filter((k) => {
    const exp = parseOccExpiryKey(k);
    return exp === today;
  });
  const spxw = zeroDte.filter((k) => k.trim().toUpperCase().startsWith("SPXW"));
  const sorted = sortOptionKeysNearTheMoney(spxw, spot);
  return sorted.slice(0, count);
}

export async function startDeskLiveFlowTimesaleDebug(): Promise<void> {
  if (!deskLiveFlowTimesaleDebugEnabled()) return;
  const keys = await pickSpxw0dteNearMoney(5);
  if (keys.length === 0) {
    logger.warn("Desk TIMESALE debug: no SPXW 0DTE keys on desk streamer yet — will retry on universe refresh");
    return;
  }
  if (started && subscribedKeys.join(",") === keys.join(",")) return;
  subscribedKeys = keys;
  deskStreamerAddTimesaleOptions(keys);
  started = true;
  logger.info({ prefix: LOG_PREFIX, keys }, "Desk TIMESALE_OPTIONS debug subs added");
}

export function deskLiveFlowTimesaleOnStreamerConnected(connectionId: number): void {
  if (!deskLiveFlowTimesaleDebugEnabled()) return;
  if (connectionId === lastConnectionId) return;
  lastConnectionId = connectionId;
  started = false;
  void startDeskLiveFlowTimesaleDebug();
}

export function deskLiveFlowTimesaleStopDebug(): void {
  if (subscribedKeys.length > 0) deskStreamerUnsubTimesaleOptions(subscribedKeys);
  subscribedKeys = [];
  started = false;
}

export function deskLiveFlowTimesaleSubscribedKeysForTests(): string[] {
  return [...subscribedKeys];
}

export function deskLiveFlowTimesaleResetForTests(): void {
  ring.length = 0;
  subscribedKeys = [];
  started = false;
  lastConnectionId = -1;
}