/**
 * Models Schwab streamer service lists: SUBS replaces the app list; ADD extends desk keys.
 * Used for health reporting and cap tests (live keys on the broker, not local ADD intent).
 */

type WireReq = {
  service?: string;
  command?: string;
  parameters?: { keys?: string; fields?: string };
};

const liveAppL1Options = new Set<string>();
const liveDeskL1Options = new Set<string>();
/** Schwab counts every key in each ADD toward the cap, including duplicate ADD of keys already live. */
let levelOneOptionsAddPressure = 0;
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
    levelOneOptionsAddPressure = keys.length;
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
    levelOneOptionsAddPressure += keys.length;
    // App quotes use the short LEVELONE field list. Desk adds request every field.
    // Schwab ADD does not replace the service list, so neither set is cleared.
    const nFields = (req.parameters?.fields ?? "").split(",").filter(Boolean).length;
    const dest = nFields > 0 && nFields <= 24 ? liveAppL1Options : liveDeskL1Options;
    for (const k of keys) dest.add(k);
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
  levelOneOptionsAddPressure = 0;
}

/** Keys accounted toward Schwab LEVELONE_OPTIONS cap (duplicate ADD batches count again). */
export function streamerWireSimulatorLevelOneAddPressure(): number {
  return levelOneOptionsAddPressure;
}

/** Schwab ADD/SUBS rejections drop keys from the broker-side list model. */
export function streamerWireSimulatorRemoveLevelOneOptions(keys: string[]): void {
  for (const k of keys) {
    liveAppL1Options.delete(k);
    liveDeskL1Options.delete(k);
  }
}

export function streamerWireSimulatorAllLevelOneKeysOnWire(): Set<string> {
  const live = new Set<string>();
  for (const k of liveAppL1Options) live.add(k);
  for (const k of liveDeskL1Options) live.add(k);
  return live;
}

export function streamerWireSimulatorAllOptionsBookKeysOnWire(): Set<string> {
  const live = new Set<string>();
  for (const k of liveAppOptionsBook) live.add(k);
  for (const k of liveDeskOptionsBook) live.add(k);
  return live;
}

export function streamerWireSimulatorDropLevelOneByPriority(priorityOrder: string[], count: number): void {
  if (count <= 0) return;
  const toDrop: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < priorityOrder.length && toDrop.length < count; i++) {
    const k = priorityOrder[i]!;
    if (seen.has(k)) continue;
    seen.add(k);
    toDrop.push(k);
  }
  streamerWireSimulatorRemoveLevelOneOptions(toDrop);
}

export function streamerWireSimulatorRemoveOptionsBook(keys: string[]): void {
  for (const k of keys) {
    liveAppOptionsBook.delete(k);
    liveDeskOptionsBook.delete(k);
  }
}
