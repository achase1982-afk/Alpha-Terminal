import { classShareSchwabStreamKey, isClassShareSymbol } from "./classShareSymbology.js";

const classShareStreamKeyToDisplays = new Map<string, Set<string>>();

export function registerClassShareDisplay(streamKey: string, displaySymbol: string): void {
  const key = streamKey.toUpperCase().trim();
  const display = displaySymbol.toUpperCase().trim();
  if (!key || !display) return;
  let bucket = classShareStreamKeyToDisplays.get(key);
  if (!bucket) {
    bucket = new Set();
    classShareStreamKeyToDisplays.set(key, bucket);
  }
  bucket.add(display);
}

export function registerClassShareDisplayFromCaller(callerSymbol: string): void {
  const upper = callerSymbol.toUpperCase().trim();
  if (!isClassShareSymbol(upper)) return;
  registerClassShareDisplay(classShareSchwabStreamKey(upper), upper);
}

export function getClassShareDisplaysForKey(streamKey: string): ReadonlySet<string> {
  return classShareStreamKeyToDisplays.get(streamKey.toUpperCase().trim()) ?? new Set();
}

export function clearClassShareDisplayRegistry(): void {
  classShareStreamKeyToDisplays.clear();
}