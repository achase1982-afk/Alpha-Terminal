import type { TradeDirection } from "./tradeDirection.js";
import {
  CARD_BULLET_MAX_CHARS,
  CARD_BULLET_MAX_COUNT,
  cardBulletHasJoinedIdeas,
  cardBulletHasMultipleSentences,
  cardBulletHasPlaceholder,
  enforceCardBullets,
  proseToCardBullets,
} from "./cardBulletCore.js";

const MIN_BULLETS = 2;

export type CardBulletResolveInput = {
  direction: TradeDirection;
  whyBulletsFromAi?: string[] | null;
  whatKillsBulletsFromAi?: string[] | null;
  thesis: string;
  bullInvalidation: string;
  bearInvalidation: string;
  riskOfRuin: string;
  warnings: string | null;
};

function proseFallback(input: CardBulletResolveInput): {
  whyItWorks: string[];
  whatKillsIt: string[];
} {
  const bullish = input.direction === "BULLISH";
  const bearish = input.direction === "BEARISH";

  const whyRaw =
    bearish
      ? [...proseToCardBullets(input.bearInvalidation, 4), ...proseToCardBullets(input.thesis, 3)]
      : [...proseToCardBullets(input.thesis, 4), ...proseToCardBullets(input.bearInvalidation, 2)];

  const killRaw =
    bullish
      ? [
          ...proseToCardBullets(input.bullInvalidation, 4),
          ...proseToCardBullets(input.riskOfRuin, 2),
          ...proseToCardBullets(input.warnings ?? "", 2),
        ]
      : bearish
        ? [
            ...proseToCardBullets(input.bearInvalidation, 4),
            ...proseToCardBullets(input.riskOfRuin, 2),
            ...proseToCardBullets(input.warnings ?? "", 2),
          ]
        : [
            ...proseToCardBullets(input.bullInvalidation, 2),
            ...proseToCardBullets(input.bearInvalidation, 2),
            ...proseToCardBullets(input.riskOfRuin, 2),
          ];

  return {
    whyItWorks: enforceCardBullets(whyRaw).slice(0, CARD_BULLET_MAX_COUNT),
    whatKillsIt: enforceCardBullets(killRaw).slice(0, CARD_BULLET_MAX_COUNT),
  };
}

/** Prefer LLM card bullets; prose-only fallback if missing or invalid. */
export function resolveCardBullets(input: CardBulletResolveInput): {
  whyItWorks: string[];
  whatKillsIt: string[];
  source: "ai" | "prose_fallback";
} {
  const whyFromAi = enforceCardBullets(input.whyBulletsFromAi ?? []);
  const killFromAi = enforceCardBullets(input.whatKillsBulletsFromAi ?? []);

  if (whyFromAi.length >= MIN_BULLETS && killFromAi.length >= MIN_BULLETS) {
    return {
      whyItWorks: whyFromAi.slice(0, CARD_BULLET_MAX_COUNT),
      whatKillsIt: killFromAi.slice(0, CARD_BULLET_MAX_COUNT),
      source: "ai",
    };
  }

  const fb = proseFallback(input);
  return { ...fb, source: "prose_fallback" };
}

export function validateCardFaceBulletsFromAi(
  whyBullets?: string[] | null,
  whatKillsBullets?: string[] | null,
): { ok: true } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const rawWhy = whyBullets ?? [];
  const rawKill = whatKillsBullets ?? [];

  if (!Array.isArray(whyBullets) || rawWhy.length === 0) {
    issues.push("whyBullets: missing or empty — required array of card bullets");
  }
  if (!Array.isArray(whatKillsBullets) || rawKill.length === 0) {
    issues.push("whatKillsBullets: missing or empty — required array of card bullets");
  }

  const why = enforceCardBullets(rawWhy);
  const kill = enforceCardBullets(rawKill);

  for (const [label, raw] of [
    ["whyBullets", rawWhy],
    ["whatKillsBullets", rawKill],
  ] as const) {
    for (const b of raw) {
      if (typeof b !== "string") continue;
      if (cardBulletHasPlaceholder(b)) {
        issues.push(`${label}: contains {{...}} placeholder — use numeric IVR/P/C from data`);
      }
      if (cardBulletHasJoinedIdeas(b)) {
        issues.push(`${label}: one idea per bullet — no "+" or comma joining`);
      }
      if (cardBulletHasMultipleSentences(b)) {
        issues.push(`${label}: exactly one sentence per bullet — never two sentences in one string`);
      }
    }
  }

  if (why.length < MIN_BULLETS) {
    issues.push(
      `whyBullets: need at least ${MIN_BULLETS} valid bullets (max ${CARD_BULLET_MAX_CHARS} characters each)`,
    );
  }
  if (kill.length < MIN_BULLETS) {
    issues.push(
      `whatKillsBullets: need at least ${MIN_BULLETS} valid bullets (max ${CARD_BULLET_MAX_CHARS} characters each)`,
    );
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
