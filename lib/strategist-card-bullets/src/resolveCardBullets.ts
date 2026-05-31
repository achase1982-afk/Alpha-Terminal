import type { TradeDirection } from "./tradeDirection.js";
import {
  CARD_BULLET_MAX_COUNT,
  cardBulletHasJoinedIdeas,
  cardBulletHasPlaceholder,
  cardBulletLacksLossCondition,
  cardBulletLooksLikeDataReadout,
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
      ? [...proseToCardBullets(input.bearInvalidation, 4, "why"), ...proseToCardBullets(input.thesis, 3, "why")]
      : [...proseToCardBullets(input.thesis, 4, "why"), ...proseToCardBullets(input.bearInvalidation, 2, "why")];

  const killRaw =
    bullish
      ? [
          ...proseToCardBullets(input.bullInvalidation, 4, "kill"),
          ...proseToCardBullets(input.riskOfRuin, 2, "kill"),
          ...proseToCardBullets(input.warnings ?? "", 2, "kill"),
        ]
      : bearish
        ? [
            ...proseToCardBullets(input.bearInvalidation, 4, "kill"),
            ...proseToCardBullets(input.riskOfRuin, 2, "kill"),
            ...proseToCardBullets(input.warnings ?? "", 2, "kill"),
          ]
        : [
            ...proseToCardBullets(input.bullInvalidation, 2, "kill"),
            ...proseToCardBullets(input.bearInvalidation, 2, "kill"),
            ...proseToCardBullets(input.riskOfRuin, 2, "kill"),
          ];

  return {
    whyItWorks: enforceCardBullets(whyRaw, CARD_BULLET_MAX_COUNT, "why"),
    whatKillsIt: enforceCardBullets(killRaw, CARD_BULLET_MAX_COUNT, "kill"),
  };
}

/** Prefer LLM card bullets; prose-only fallback if missing or invalid. */
export function resolveCardBullets(input: CardBulletResolveInput): {
  whyItWorks: string[];
  whatKillsIt: string[];
  source: "ai" | "prose_fallback";
} {
  const whyFromAi = enforceCardBullets(input.whyBulletsFromAi ?? [], CARD_BULLET_MAX_COUNT, "why");
  const killFromAi = enforceCardBullets(input.whatKillsBulletsFromAi ?? [], CARD_BULLET_MAX_COUNT, "kill");

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
    issues.push("whyBullets: missing or empty — required array of profit-claim bullets");
  }
  if (!Array.isArray(whatKillsBullets) || rawKill.length === 0) {
    issues.push("whatKillsBullets: missing or empty — required array of loss-condition bullets");
  }

  const why = enforceCardBullets(rawWhy, CARD_BULLET_MAX_COUNT, "why");
  const kill = enforceCardBullets(rawKill, CARD_BULLET_MAX_COUNT, "kill");

  for (const b of rawWhy) {
    if (typeof b !== "string") continue;
    if (cardBulletHasPlaceholder(b)) {
      issues.push("whyBullets: contains {{...}} placeholder — state what vol/flow means for P/L");
    }
    if (cardBulletHasJoinedIdeas(b)) {
      issues.push("whyBullets: exactly one point per bullet — no '+' or comma joining");
    }
    if (cardBulletLooksLikeDataReadout(b)) {
      issues.push(
        `whyBullets: "${b.slice(0, 40)}${b.length > 40 ? "…" : ""}" fails the "so what?" test — write a profit claim, not a data readout`,
      );
    }
  }

  for (const b of rawKill) {
    if (typeof b !== "string") continue;
    if (cardBulletHasPlaceholder(b)) {
      issues.push("whatKillsBullets: contains {{...}} placeholder");
    }
    if (cardBulletHasJoinedIdeas(b)) {
      issues.push("whatKillsBullets: exactly one point per bullet — no '+' or comma joining");
    }
    if (cardBulletLacksLossCondition(b)) {
      issues.push(
        `whatKillsBullets: "${b.slice(0, 40)}${b.length > 40 ? "…" : ""}" must state when/how the position loses`,
      );
    }
  }

  if (why.length < MIN_BULLETS) {
    issues.push(
      `whyBullets: need at least ${MIN_BULLETS} valid profit-claim bullets (one skeptical claim each)`,
    );
  }
  if (kill.length < MIN_BULLETS) {
    issues.push(
      `whatKillsBullets: need at least ${MIN_BULLETS} valid loss-condition bullets (one condition each)`,
    );
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
