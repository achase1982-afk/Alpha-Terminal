import { z } from "zod";

/** Card-face bullets: one claim per line; no character cap (UI may wrap). */
export const CARD_BULLET_MAX_CHARS = 500;
export const CARD_BULLET_MAX_COUNT = 4;
export const CARD_BULLET_MIN_CHARS = 12;

/** @deprecated No longer enforced; kept for callers that still import it. */
export const CARD_BULLET_MAX_WORDS = 999;

const PROFIT_CLAIM_HINT =
  /\b(profit|profits|win|wins|edge|earn|capture|works|likely|worthless|favors?|supports?|means|because|lets|allows|expect|drift|rally|hold|rich|cheap|financed|beat|drove|express|survive|theta|justified|sell\s+premium|premium\s+to\s+sell|expire|expires|OTM|ITM|upside|downside|carry|mispriced)\b/i;

const LOSS_CONDITION_HINT =
  /\b(kill|kills|lose|loses|loss|break|breaks|invalidat|gap|gaps|crush|above|below|through|reverse|reverses|fail|fails|wipe|bleed|ruin|wrong|flip|flips|stops?\s+out|unwind|whipsaw|selloff|rally\s+through|earnings|headline)\b/i;

const DATA_READOUT_PATTERNS: RegExp[] = [
  /^(?:[A-Z]{1,5}\s+)?IVR\s*[\d.]+\s*[-—]?\s*$/i,
  /^(?:P\/C|put\/call)\s*[\d.]+\s*[-—]?\s*(vol|volume)?\s*$/i,
  /^\d+(\.\d+)?[- ]?delta\b/i,
  /^(?:BUY|SELL)\s+\w+\s+\d+\s*\$?\d+\s*(?:call|put)/i,
  /^[\d/]+\s+\$?\d+[CP]\s/i,
  /^Spot\s+\$[\d.]+\s+(?:above|below)\s+\$[\d.]+\s+short/i,
  /^Rel\s+vol\s+[\d.]+x/i,
  /^Idio\s+\d+%/i,
];

export function cardBulletWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function cardBulletHasPlaceholder(text: string): boolean {
  return /\{\{[A-Z0-9_]+\}\}/.test(text);
}

/** One claim per bullet — no "+" or comma splicing two ideas. */
export function cardBulletHasJoinedIdeas(text: string): boolean {
  return /\s\+\s/.test(text) || /,/.test(text);
}

/** Why bullet reads as a stat/label, not a profit claim (fails the "so what?" test). */
export function cardBulletLooksLikeDataReadout(text: string): boolean {
  const s = text.trim();
  if (!s) return true;
  if (PROFIT_CLAIM_HINT.test(s)) return false;
  for (const p of DATA_READOUT_PATTERNS) {
    if (p.test(s)) return true;
  }
  if (/\d/.test(s) && s.length < 48 && !/\b(so|if|when|unless|because|means|lets)\b/i.test(s)) {
    return true;
  }
  return false;
}

/** Kill bullet must state a plain-language loss condition, not a raw stat. */
export function cardBulletLacksLossCondition(text: string): boolean {
  const s = text.trim();
  if (!s) return true;
  return !LOSS_CONDITION_HINT.test(s);
}

export function normalizeCardBullet(raw: string): string | null {
  let s = raw
    .replace(/\u2014/g, " — ")
    .replace(/^[⚠️~▲▼]+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length < CARD_BULLET_MIN_CHARS) return null;
  if (s.length > CARD_BULLET_MAX_CHARS) return null;
  if (s.includes("\n") || s.includes("\r")) return null;
  return s;
}

/** @deprecated Use normalizeCardBullet; kept for tests and legacy imports. */
export function tightenCardBullet(raw: string): string | null {
  return normalizeCardBullet(raw);
}

export type CardBulletSection = "why" | "kill";

export function validateCardBullet(
  text: string,
  section: CardBulletSection = "why",
): { ok: true; bullet: string } | { ok: false; reason: string } {
  if (cardBulletHasPlaceholder(text)) return { ok: false, reason: "placeholder" };
  const bullet = normalizeCardBullet(text);
  if (!bullet) return { ok: false, reason: "invalid" };
  if (cardBulletHasPlaceholder(bullet)) return { ok: false, reason: "placeholder" };
  if (cardBulletHasJoinedIdeas(bullet)) return { ok: false, reason: "joined_ideas" };
  if (section === "why" && cardBulletLooksLikeDataReadout(bullet)) {
    return { ok: false, reason: "data_not_claim" };
  }
  if (section === "kill" && cardBulletLacksLossCondition(bullet)) {
    return { ok: false, reason: "not_loss_condition" };
  }
  return { ok: true, bullet };
}

export const cardBulletSchema = z
  .string()
  .min(CARD_BULLET_MIN_CHARS)
  .max(CARD_BULLET_MAX_CHARS)
  .refine((s) => !/[\r\n]/.test(s), { message: "card bullet must be a single line" })
  .refine((s) => !cardBulletHasPlaceholder(s), { message: "card bullet must not contain placeholders" })
  .refine((s) => !cardBulletHasJoinedIdeas(s), { message: "card bullet must be one idea" });

export const cardWhyBulletSchema = cardBulletSchema.refine(
  (s) => !cardBulletLooksLikeDataReadout(s),
  { message: "why bullet must be a profit claim, not a data readout" },
);

export const cardKillBulletSchema = cardBulletSchema.refine(
  (s) => !cardBulletLacksLossCondition(s),
  { message: "kill bullet must state when the position loses" },
);

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
  return text.replace(EM_DASH, " — ").trim();
}

export function compressCardBullet(raw: string, section: CardBulletSection = "why"): string | null {
  const first = normalizeCardBullet(raw);
  if (first && validateCardBullet(first, section).ok) return first;

  let s = stripEmDashesForBullet(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt >= 1) {
      s = s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    }
    if (attempt >= 2) {
      const clause = s.split(/[,;]/)[0]?.trim();
      if (clause) s = clause;
    }
    const normalized = normalizeCardBullet(s);
    if (normalized && validateCardBullet(normalized, section).ok) return normalized;
  }
  return null;
}

export function enforceCardBullets(
  bullets: string[],
  max = CARD_BULLET_MAX_COUNT,
  section: CardBulletSection = "why",
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of bullets) {
    if (out.length >= max) break;
    const validated = validateCardBullet(raw, section);
    const candidate = validated.ok
      ? validated.bullet
      : (() => {
          const compressed = compressCardBullet(raw, section);
          if (!compressed) return null;
          const recheck = validateCardBullet(compressed, section);
          return recheck.ok ? recheck.bullet : null;
        })();
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }

  return out;
}

export function proseToCardBullets(
  text: string,
  max = CARD_BULLET_MAX_COUNT,
  section: CardBulletSection = "why",
): string[] {
  if (!text?.trim()) return [];
  const cleaned = stripEmDashesForBullet(text);
  const parts = cleaned
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[-•*]\s*/, "").trim())
    .filter((s) => s.length >= CARD_BULLET_MIN_CHARS);

  const compressed: string[] = [];
  for (const part of parts) {
    const bullet = compressCardBullet(part, section);
    if (bullet) compressed.push(bullet);
    if (compressed.length >= max) break;
  }
  return enforceCardBullets(compressed, max, section);
}
