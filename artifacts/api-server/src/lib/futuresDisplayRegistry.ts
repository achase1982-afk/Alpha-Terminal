/** Many display symbols (root + contract) can share one Schwab stream key. */
const futuresKeyToDisplays = new Map<string, Set<string>>();

export function registerFuturesDisplay(streamKey: string, displaySymbol: string): void {
  const key = streamKey.toUpperCase().trim();
  const display = displaySymbol.toUpperCase().trim();
  if (!key || !display) return;
  let bucket = futuresKeyToDisplays.get(key);
  if (!bucket) {
    bucket = new Set();
    futuresKeyToDisplays.set(key, bucket);
  }
  bucket.add(display);
}

export function addFuturesDisplay(streamKey: string, displaySymbol: string): void {
  registerFuturesDisplay(streamKey, displaySymbol);
}

export function getFuturesDisplaysForKey(streamKey: string): ReadonlySet<string> {
  return futuresKeyToDisplays.get(streamKey.toUpperCase().trim()) ?? new Set();
}

export function clearFuturesDisplayRegistry(): void {
  futuresKeyToDisplays.clear();
}

export function futuresDisplayRegistrySnapshot(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, set] of futuresKeyToDisplays.entries()) {
    out[k] = [...set].sort();
  }
  return out;
}