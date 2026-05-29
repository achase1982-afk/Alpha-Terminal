import { z } from "zod";

/** Card-face bullet limits: one idea, no numbers/parens, detail lives in full report. */
export const CARD_BULLET_MAX_CHARS = 70;
export const CARD_BULLET_MAX_WORDS = 10;
export const CARD_BULLET_MAX_COUNT = 6;
export const CARD_BULLET_MIN_CHARS = 8;

const HAS_DIGIT = /\d/;
const HAS_PARENS = /[()]/;

export function cardBulletWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function validateCardBullet(
  text: string,
): { ok: true; bullet: string } | { ok: false; reason: string } {
  const bullet = text.replace(/\s+/g, " ").trim();
  if (bullet.length < CARD_BULLET_MIN_CHARS) {
    return { ok: false, reason: "too_short" };
  }
  if (bullet.includes("\n") || bullet.includes("\r")) {
    return { ok: false, reason: "multiline" };
  }
  if (bullet.length > CARD_BULLET_MAX_CHARS) {
    return { ok: false, reason: "too_long" };
  }
  if (cardBulletWordCount(bullet) > CARD_BULLET_MAX_WORDS) {
    return { ok: false, reason: "too_many_words" };
  }
  if (HAS_DIGIT.test(bullet)) {
    return { ok: false, reason: "has_digits" };
  }
  if (HAS_PARENS.test(bullet)) {
    return { ok: false, reason: "has_parens" };
  }
  return { ok: true, bullet };
}

export const cardBulletSchema = z
  .string()
  .min(CARD_BULLET_MIN_CHARS)
  .max(CARD_BULLET_MAX_CHARS)
  .refine((s) => !/\d/.test(s), { message: "card bullet must not contain digits" })
  .refine((s) => !/[()]/.test(s), { message: "card bullet must not contain parentheses" })
  .refine((s) => !/[\r\n]/.test(s), { message: "card bullet must be a single line" })
  .refine((s) => cardBulletWordCount(s) <= CARD_BULLET_MAX_WORDS, {
    message: `card bullet must be at most ${CARD_BULLET_MAX_WORDS} words`,
  });

export const cardBulletsSchema = z
  .array(cardBulletSchema)
  .max(CARD_BULLET_MAX_COUNT);

export type CardBulletsValidation =
  | { ok: true; bullets: string[] }
  | { ok: false; error: string; invalid: string[] };

export function parseCardBullets(raw: unknown): CardBulletsValidation {
  const parsed = cardBulletsSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, bullets: parsed.data };
  }
  const invalid = Array.isArray(raw)
    ? raw.filter((s): s is string => typeof s === "string" && !cardBulletSchema.safeParse(s).success)
    : [];
  return { ok: false, error: parsed.error.message, invalid };
}

const EM_DASH = /\u2014/g;

export function stripEmDashesForBullet(text: string): string {
  return text.replace(EM_DASH, ",").trim();
}

/** Escalating compression; returns null if still invalid after retries. */
export function compressCardBullet(raw: string, maxAttempts = 6): string | null {
  let s = stripEmDashesForBullet(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt >= 1) {
      s = s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    }
    if (attempt >= 2) {
      s = s
        .replace(/\d+(\.\d+)?%?/g, "")
        .replace(/[$%]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    if (attempt >= 3) {
      const clause = s.split(/[,;]/)[0]?.trim();
      if (clause && clause.length >= CARD_BULLET_MIN_CHARS) s = clause;
    }
    if (attempt >= 4) {
      const words = s.split(/\s+/).filter(Boolean);
      if (words.length > CARD_BULLET_MAX_WORDS) {
        s = words.slice(0, CARD_BULLET_MAX_WORDS).join(" ");
      }
    }
    if (attempt >= 5 && s.length > CARD_BULLET_MAX_CHARS) {
      s = s.slice(0, CARD_BULLET_MAX_CHARS).trimEnd();
      const lastSpace = s.lastIndexOf(" ");
      if (lastSpace >= CARD_BULLET_MIN_CHARS) {
        s = s.slice(0, lastSpace);
      }
    }

    const checked = validateCardBullet(s);
    if (checked.ok) return checked.bullet;
  }
  return null;
}

/** Validate each bullet; compress/retry invalid entries; drop failures. */
export function enforceCardBullets(
  bullets: string[],
  max = CARD_BULLET_MAX_COUNT,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of bullets) {
    if (out.length >= max) break;
    const validated = validateCardBullet(raw);
    const candidate = validated.ok ? validated.bullet : compressCardBullet(raw);
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }

  const parsed = cardBulletsSchema.safeParse(out);
  return parsed.success ? parsed.data : [];
}

export function proseToCardBullets(text: string, max = CARD_BULLET_MAX_COUNT): string[] {
  if (!text?.trim()) return [];
  const cleaned = stripEmDashesForBullet(text);
  const parts = cleaned
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[-•*]\s*/, "").trim())
    .filter((s) => s.length >= CARD_BULLET_MIN_CHARS);

  const compressed: string[] = [];
  for (const part of parts) {
    const bullet = compressCardBullet(part);
    if (bullet) compressed.push(bullet);
    if (compressed.length >= max) break;
  }
  return enforceCardBullets(compressed, max);
}

const WHY_FALLBACK = "Defined risk with favorable skew";
const KILL_FALLBACK = "Sharp move against the position";

export function buildCardBriefBullets(args: {
  thesis: string;
  bullInvalidation: string;
  bearInvalidation: string;
  riskOfRuin: string;
  warnings: string | null;
}): { whyItWorks: string[]; whatKillsIt: string[] } {
  const whyFromThesis = proseToCardBullets(args.thesis, 4);
  const whyExtra = proseToCardBullets(args.bullInvalidation, 2);
  let whyItWorks = enforceCardBullets([...whyFromThesis, ...whyExtra]);

  const killFromBear = proseToCardBullets(args.bearInvalidation, 3);
  const killFromRisk = proseToCardBullets(args.riskOfRuin, 2);
  const killFromWarn = proseToCardBullets(args.warnings ?? "", 2);
  let whatKillsIt = enforceCardBullets([...killFromBear, ...killFromRisk, ...killFromWarn]);

  if (whyItWorks.length === 0) {
    const fallback = compressCardBullet(args.thesis) ?? WHY_FALLBACK;
    whyItWorks = enforceCardBullets([fallback]);
  }
  if (whatKillsIt.length === 0) {
    const src = args.warnings ?? args.bearInvalidation ?? args.riskOfRuin;
    const fallback = (src && compressCardBullet(src)) || KILL_FALLBACK;
    whatKillsIt = enforceCardBullets([fallback]);
  }

  return {
    whyItWorks: whyItWorks.slice(0, CARD_BULLET_MAX_COUNT),
    whatKillsIt: whatKillsIt.slice(0, CARD_BULLET_MAX_COUNT),
  };
}
