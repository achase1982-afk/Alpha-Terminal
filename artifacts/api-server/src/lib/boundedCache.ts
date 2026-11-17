/**
 * Insertion-ordered size cap for module-level `Map` caches.
 *
 * Several per-symbol caches (SEC filings, index chain structure, reference
 * contract stats, earnings history) check a TTL on read but never evict, so a
 * long-running process accumulates an entry for every symbol ever requested.
 * `setBounded` refreshes insertion order on write and drops the oldest entries
 * once the map exceeds `max`, keeping memory proportional to recent activity.
 */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max = 500): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size <= max) return;
  const excess = map.size - max;
  let removed = 0;
  for (const k of map.keys()) {
    map.delete(k);
    removed += 1;
    if (removed >= excess) break;
  }
}
