import { createHash } from "node:crypto";
import type { MoversNewsHeadline } from "./fmpMoversNews.js";

export function buildMoversNewsKey(headline: MoversNewsHeadline): string {
  const raw = `${headline.symbol}|${headline.publishedAt}|${headline.title}`.toLowerCase().trim();
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

export function pickDrivingHeadline(headlines: MoversNewsHeadline[]): MoversNewsHeadline | null {
  if (headlines.length === 0) return null;
  const sorted = [...headlines].sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || 0;
    const tb = Date.parse(b.publishedAt) || 0;
    return tb - ta;
  });
  return sorted[0] ?? null;
}
