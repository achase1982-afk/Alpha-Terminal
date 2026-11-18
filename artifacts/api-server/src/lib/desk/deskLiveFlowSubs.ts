import type { DeskFlowAssetKind } from "./deskLiveFlowSymbol.js";
import { deskFlowNormalizeEquityKey } from "./deskLiveFlowSymbol.js";
import {
  deskFlowStreamerEnsureEquityL1,
  deskFlowStreamerEnsureFuturesL1,
  deskFlowStreamerEnsureTimesaleEquity,
  deskFlowStreamerEnsureTimesaleFutures,
  deskFlowStreamerReleaseEquityL1,
  deskFlowStreamerReleaseFuturesL1,
  deskFlowStreamerReleaseTimesaleEquity,
  deskFlowStreamerReleaseTimesaleFutures,
} from "../schwabStreamer.js";
import { logger } from "../logger.js";

type Held = {
  kind: DeskFlowAssetKind;
  refs: number;
  addedL1: boolean;
  addedTimesale: boolean;
};

const held = new Map<string, Held>();
const pendingFuturesDisplay: string[] = [];

export function deskLiveFlowSubsLastFuturesDisplay(): string | null {
  return pendingFuturesDisplay.at(-1) ?? null;
}

function keyFor(sym: string, kind: DeskFlowAssetKind): string {
  return `${kind}:${sym.toUpperCase()}`;
}

export function deskLiveFlowSubsAcquire(sym: string, kind: DeskFlowAssetKind): void {
  const k = keyFor(sym, kind);
  let h = held.get(k);
  if (!h) {
    h = { kind, refs: 0, addedL1: false, addedTimesale: false };
    held.set(k, h);
  }
  if (h.refs === 0 && kind !== "spx") {
    try {
      if (kind === "equity") {
        const eq = deskFlowNormalizeEquityKey(sym);
        h.addedL1 = deskFlowStreamerEnsureEquityL1(eq);
        h.addedTimesale = deskFlowStreamerEnsureTimesaleEquity(eq);
      } else if (kind === "futures") {
        const ds = sym.startsWith("/") ? sym.toUpperCase() : `/${sym.toUpperCase()}`;
        pendingFuturesDisplay.push(ds);
        if (pendingFuturesDisplay.length > 8) pendingFuturesDisplay.shift();
        h.addedL1 = deskFlowStreamerEnsureFuturesL1(ds);
        h.addedTimesale = deskFlowStreamerEnsureTimesaleFutures(ds);
      }
    } catch (err) {
      logger.warn({ err, sym, kind }, "Desk live flow: streamer acquire failed");
    }
  }
  h.refs += 1;
}

export function deskLiveFlowSubsRelease(sym: string, kind: DeskFlowAssetKind): void {
  const k = keyFor(sym, kind);
  const h = held.get(k);
  if (!h) return;
  h.refs = Math.max(0, h.refs - 1);
  if (h.refs > 0) return;
  held.delete(k);
  if (kind === "spx") return;
  try {
    if (kind === "equity") {
      const eq = deskFlowNormalizeEquityKey(sym);
      if (h.addedTimesale) deskFlowStreamerReleaseTimesaleEquity(eq);
      if (h.addedL1) deskFlowStreamerReleaseEquityL1(eq);
    } else if (kind === "futures") {
      const ds = sym.startsWith("/") ? sym.toUpperCase() : `/${sym.toUpperCase()}`;
      if (h.addedTimesale) deskFlowStreamerReleaseTimesaleFutures(ds);
      if (h.addedL1) deskFlowStreamerReleaseFuturesL1(ds);
    }
  } catch (err) {
    logger.warn({ err, sym, kind }, "Desk live flow: streamer release failed");
  }
}

export function deskLiveFlowSubsSymbolActive(sym: string, kind: DeskFlowAssetKind): boolean {
  const normalized =
    kind === "futures"
      ? sym.trim().toUpperCase().startsWith("/")
        ? sym.trim().toUpperCase()
        : `/${sym.trim().toUpperCase()}`
      : kind === "equity"
        ? deskFlowNormalizeEquityKey(sym)
        : sym.trim().toUpperCase().replace(/^\$/, "");
  const k = keyFor(normalized, kind);
  return (held.get(k)?.refs ?? 0) > 0;
}

export function deskLiveFlowSubsResetForTests(): void {
  held.clear();
}

export function deskLiveFlowSubsActiveCountForTests(): number {
  return held.size;
}