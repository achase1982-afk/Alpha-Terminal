import { createHash } from "node:crypto";
import type { MoversNewsHeadline } from "./fmpMoversNews.js";

export function buildMoversNewsKey(headline: MoversNewsHeadline): string {
  const raw = `${headline.symbol}|${headline.publishedAt}|${headline.title}`.toLowerCase().trim();
  return createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

/** Law-firm / class-action solicitation headlines trail the move; not primary catalysts. */
export function isLitigationSolicitationHeadline(title: string): boolean {
  const hay = title.toLowerCase();
  const patterns = [
    /law firm/,
    /class action/,
    /shareholder investigation/,
    /securities fraud/,
    /investors (have|with|who|are encouraged|may contact)/,
    /join (the )?investigation/,
    /encourages (investors|shareholders)/,
    /reminds investors/,
    /announces investigation/,
    /files (a )?class action/,
    /deadline.*(lawsuit|class action)/,
    /opportunity to (serve|lead|join)/,
    /contact (the )?firm/,
    /pomerantz/,
    /schall law/,
    /rosen law/,
    /bernstein liebhard/,
    /faruqi/,
    /glancy prongay/,
  ];
  return patterns.some((p) => p.test(hay));
}

export function pickDrivingHeadline(headlines: MoversNewsHeadline[]): MoversNewsHeadline | null {
  if (headlines.length === 0) return null;
  const sorted = [...headlines].sort((a, b) => {
    const ta = Date.parse(a.publishedAt) || 0;
    const tb = Date.parse(b.publishedAt) || 0;
    return tb - ta;
  });
  const substantive = sorted.filter((h) => !isLitigationSolicitationHeadline(h.title));
  const pool = substantive.length > 0 ? substantive : sorted;
  return pool[0] ?? null;
}

/** Match LLM-returned title to a fetched headline for newsKey generation. */
export function resolveHeadlineByTitle(
  headlines: MoversNewsHeadline[],
  title: string,
): MoversNewsHeadline | null {
  const norm = title.trim().toLowerCase();
  if (!norm) return null;
  const exact = headlines.find((h) => h.title.trim().toLowerCase() === norm);
  if (exact) return exact;
  const partial = headlines.find(
    (h) =>
      h.title.toLowerCase().includes(norm) ||
      norm.includes(h.title.trim().toLowerCase()),
  );
  return partial ?? null;
}
