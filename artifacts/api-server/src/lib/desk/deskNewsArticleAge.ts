/** Max article published time in ms from desk news payloads (null when none). */
export function deskMaxArticlePublishedMs(articles: unknown[]): number | null {
  let max: number | null = null;
  for (const raw of articles) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    let ms: number | null = null;
    if (typeof a.datetime === "number" && Number.isFinite(a.datetime)) {
      ms = a.datetime < 1e12 ? a.datetime * 1000 : a.datetime;
    } else if (typeof a.created_at === "string") {
      const t = Date.parse(a.created_at);
      if (Number.isFinite(t)) ms = t;
    } else if (typeof a.updated_at === "string") {
      const t = Date.parse(a.updated_at);
      if (Number.isFinite(t)) ms = t;
    }
    if (ms != null) max = max == null ? ms : Math.max(max, ms);
  }
  return max;
}
