const KEY = "at_glance_compact:v1";

export function loadAtGlanceCompact(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAtGlanceCompact(compact: boolean): void {
  try {
    localStorage.setItem(KEY, compact ? "1" : "0");
  } catch {
    /* ignore */
  }
}