import { z } from "zod";

/** iPhone one-line card bullets (13px body). */
export const CARD_BULLET_MAX_CHARS = 50;
export const CARD_BULLET_MAX_WORDS = 7;
export const CARD_BULLET_MAX_COUNT = 6;
export const CARD_BULLET_MIN_CHARS = 6;

const FILLER = new Set([
  "a",
  "an",
  "the",
  "with",
  "that",
  "this",
  "very",
  "really",
  "highly",
  "while",
  "from",
  "into",
  "its",
  "your",
  "also",
  "just",
  "only",
]);

export function cardBulletWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function tightenCardBullet(raw: string): string | null {
  let s = raw
    .replace(/\u2014/g, ",")
    .replace(/^[⚠️~▲▼]+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;

  let words = s.split(" ").filter((w) => w.length > 0 && !FILLER.has(w.toLowerCase()));
  if (words.length === 0) return null;
  if (words.length > CARD_BULLET_MAX_WORDS) {
    words = words.slice(0, CARD_BULLET_MAX_WORDS);
  }
  s = words.join(" ");

  if (s.length > CARD_BULLET_MAX_CHARS) {
    s = s.slice(0, CARD_BULLET_MAX_CHARS).trimEnd();
    const sp = s.lastIndexOf(" ");
    if (sp >= CARD_BULLET_MIN_CHARS) s = s.slice(0, sp);
  }

  if (s.length < CARD_BULLET_MIN_CHARS) return null;
  if (s.includes("\n") || s.includes("\r")) return null;
  return s;
}

export function validateCardBullet(
  text: string,
): { ok: true; bullet: string } | { ok: false; reason: string } {
  const bullet = tightenCardBullet(text);
  if (!bullet) return { ok: false, reason: "invalid" };
  return { ok: true, bullet };
}

export const cardBulletSchema = z
  .string()
  .min(CARD_BULLET_MIN_CHARS)
  .max(CARD_BULLET_MAX_CHARS)
  .refine((s) => !/[\r\n]/.test(s), { message: "card bullet must be a single line" })
  .refine((s) => cardBulletWordCount(s) <= CARD_BULLET_MAX_WORDS, {
    message: `card bullet must be at most ${CARD_BULLET_MAX_WORDS} words`,
  });

export const cardBulletsSchema = z.array(cardBulletSchema).max(CARD_BULLET_MAX_COUNT);

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

export function compressCardBullet(raw: string, maxAttempts = 5): string | null {
  const first = tightenCardBullet(raw);
  if (first) return first;

  let s = stripEmDashesForBullet(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt >= 1) {
      s = s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    }
    if (attempt >= 2) {
      const clause = s.split(/[,;]/)[0]?.trim();
      if (clause) s = clause;
    }
    const tightened = tightenCardBullet(s);
    if (tightened) return tightened;
  }
  return null;
}

export function enforceCardBullets(
  bullets: string[],
  max = CARD_BULLET_MAX_COUNT,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of bullets) {
    if (out.length >= max) break;
    const candidate = tightenCardBullet(raw) ?? compressCardBullet(raw);
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
