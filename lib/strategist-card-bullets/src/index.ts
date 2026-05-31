export {
  deriveTradeDirection,
  tradeDirectionToCardLabel,
  type TradeDirection,
  type TradeLeg,
  type DebateVerdict,
} from "./tradeDirection.js";

export {
  CARD_BULLET_MAX_CHARS,
  CARD_BULLET_MAX_WORDS,
  CARD_BULLET_MAX_COUNT,
  CARD_BULLET_MIN_CHARS,
  cardBulletWordCount,
  cardBulletHasPlaceholder,
  cardBulletHasJoinedIdeas,
  cardBulletLooksLikeDataReadout,
  cardBulletLacksLossCondition,
  normalizeCardBullet,
  tightenCardBullet,
  validateCardBullet,
  type CardBulletSection,
  cardBulletSchema,
  cardBulletsSchema,
  parseCardBullets,
  stripEmDashesForBullet,
  compressCardBullet,
  enforceCardBullets,
  proseToCardBullets,
  type CardBulletsValidation,
} from "./cardBulletCore.js";

export { CARD_FACE_BULLET_PROMPT } from "./cardBulletPrompt.js";
export {
  resolveCardBullets,
  validateCardFaceBulletsFromAi,
  type CardBulletResolveInput,
} from "./resolveCardBullets.js";
export { buildCardBriefBullets, type CardBulletBuildInput } from "./buildCardBullets.js";
