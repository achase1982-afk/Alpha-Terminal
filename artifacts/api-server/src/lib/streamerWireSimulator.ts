/**
 * Models Schwab streamer service lists: SUBS replaces the app list; ADD extends desk keys.
 * Used for health reporting and cap tests (live keys on the broker, not local ADD intent).
 */

type WireReq = {
  service?: string;
  command?: string;
  parameters?: { keys?: string };
};

const liveAppL1Options = new Set<string>();
const liveDeskL1Options = new Set<string>();
const liveAppOptionsBook = new Set<string>();
const liveDeskOptionsBook = new Set<string>();

function parseKeys(keys: string | undefined): string[] {
  if (!keys?.trim()) return [];
  return keys.split(",").map((k) => k.trim()).filter(Boolean);
}

function applyLevelOneOptions(req: WireReq): void {
  const keys = parseKeys(req.parameters?.keys);
  const cmd = req.command?.toUpperCase();
  if (cmd === "SUBS") {
    liveAppL1Options.clear();
    for (const k of keys) liveAppL1Options.add(k);
    liveDeskL1Options.clear();
    return;
  }
  if (cmd === "UNSUBS") {
    for (const k of keys) {
      liveAppL1Options.delete(k);
      liveDeskL1Options.delete(k);
    }
    return;
  }
  if (cmd === "ADD") {
    for (const k of keys) liveDeskL1Options.add(k);
  }
}

function applyOptionsBook(req: WireReq): void {
  const keys = parseKeys(req.parameters?.keys);
  const cmd = req.command?.toUpperCase();
  if (cmd === "SUBS") {
    liveAppOptionsBook.clear();
    for (const k of keys) liveAppOptionsBook.add(k);
    liveDeskOptionsBook.clear();
    return;
  }
  if (cmd === "UNSUBS") {
    for (const k of keys) {
      liveAppOptionsBook.delete(k);
      liveDeskOptionsBook.delete(k);
    }
    return;
  }
  if (cmd === "ADD") {
    for (const k of keys) liveDeskOptionsBook.add(k);
  }
}

export function streamerWireSimulatorApplyPayload(payload: unknown): void {
  const body = payload as { requests?: WireReq[] };
  for (const r of body.requests ?? []) {
    if (r.service === "LEVELONE_OPTIONS") applyLevelOneOptions(r);
    else if (r.service === "OPTIONS_BOOK") applyOptionsBook(r);
  }
}

export function streamerWireSimulatorLiveLevelOneOptionsCount(): number {
  const live = new Set<string>();
  for (const k of liveAppL1Options) live.add(k);
  for (const k of liveDeskL1Options) {
    if (!liveAppL1Options.has(k)) live.add(k);
  }
  return live.size;
}

export function streamerWireSimulatorLiveDeskLevelOneCount(): number {
  return liveDeskL1Options.size;
}

export function streamerWireSimulatorLiveAppLevelOneCount(): number {
  return liveAppL1Options.size;
}

export function streamerWireSimulatorDeskLevelOneKeysOnWire(): Set<string> {
  return new Set(liveDeskL1Options);
}

export function streamerWireSimulatorLiveOptionsBookCount(): number {
  const live = new Set<string>();
  for (const k of liveAppOptionsBook) live.add(k);
  for (const k of liveDeskOptionsBook) {
    if (!liveAppOptionsBook.has(k)) live.add(k);
  }
  return live.size;
}

export function streamerWireSimulatorResetForTests(): void {
  liveAppL1Options.clear();
  liveDeskL1Options.clear();
  liveAppOptionsBook.clear();
  liveDeskOptionsBook.clear();
}

/** Schwab ADD/SUBS rejections drop keys from the broker-side list model. */
export function streamerWireSimulatorRemoveLevelOneOptions(keys: string[]): void {
  for (const k of keys) {
    liveAppL1Options.delete(k);
    liveDeskL1Options.delete(k);
  }
}

export function streamerWireSimulatorRemoveOptionsBook(keys: string[]): void {
  for (const k of keys) {
    liveAppOptionsBook.delete(k);
    liveDeskOptionsBook.delete(k);
  }
}
