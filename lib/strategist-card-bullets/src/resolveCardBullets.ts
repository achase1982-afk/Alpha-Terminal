import type { TradeDirection } from "./tradeDirection.js";
import {
  CARD_BULLET_MAX_CHARS,
  CARD_BULLET_MAX_COUNT,
  cardBulletHasJoinedIdeas,
  cardBulletHasMultipleSentences,
  cardBulletHasPlaceholder,
  cardBulletIsStructureReadout,
  enforceCardBullets,
  proseToCardBullets,
} from "./cardBulletCore.js";
import { buildCardBriefBullets, type CardBulletBuildInput } from "./buildCardBullets.js";

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
  /** When AI why bullets are structure readouts, backfill from data + thesis. */
  dataBackfill?: CardBulletBuildInput;
};

function filterWhyBullets(bullets: string[]): string[] {
  return bullets.filter((b) => !cardBulletIsStructureReadout(b));
}

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
  const whyFromAiRaw = enforceCardBullets(input.whyBulletsFromAi ?? []);
  const whyFromAi = filterWhyBullets(whyFromAiRaw);
  const killFromAi = enforceCardBullets(input.whatKillsBulletsFromAi ?? []);

  let whyItWorks = whyFromAi;
  if (whyItWorks.length < MIN_BULLETS && input.dataBackfill) {
    const built = buildCardBriefBullets(input.dataBackfill);
    whyItWorks = enforceCardBullets([...built.whyItWorks, ...whyFromAi]).slice(0, CARD_BULLET_MAX_COUNT);
  }

  if (whyItWorks.length >= MIN_BULLETS && killFromAi.length >= MIN_BULLETS) {
    return {
      whyItWorks,
      whatKillsIt: killFromAi.slice(0, CARD_BULLET_MAX_COUNT),
      source: whyFromAi.length >= MIN_BULLETS ? "ai" : "prose_fallback",
    };
  }

  const fb = proseFallback(input);
  if (input.dataBackfill) {
    const built = buildCardBriefBullets(input.dataBackfill);
    const mergedWhy = enforceCardBullets([...built.whyItWorks, ...fb.whyItWorks]).slice(0, CARD_BULLET_MAX_COUNT);
    if (mergedWhy.length >= MIN_BULLETS) {
      return {
        whyItWorks: mergedWhy,
        whatKillsIt:
          killFromAi.length >= MIN_BULLETS
            ? killFromAi.slice(0, CARD_BULLET_MAX_COUNT)
            : enforceCardBullets([...built.whatKillsIt, ...fb.whatKillsIt]).slice(0, CARD_BULLET_MAX_COUNT),
        source: "prose_fallback",
      };
    }
  }
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

  const why = filterWhyBullets(enforceCardBullets(rawWhy));
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
      if (label === "whyBullets" && cardBulletIsStructureReadout(b)) {
        issues.push(
          `${label}: "${b.slice(0, 40)}..." is a structure readout — use catalyst/vol/tape profit thesis, not strike vs spot`,
        );
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
