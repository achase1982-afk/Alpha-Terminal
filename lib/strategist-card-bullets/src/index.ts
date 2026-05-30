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
  tightenCardBullet,
  validateCardBullet,
  cardBulletSchema,
  cardBulletsSchema,
  parseCardBullets,
  stripEmDashesForBullet,
  compressCardBullet,
  enforceCardBullets,
  proseToCardBullets,
  type CardBulletsValidation,
} from "./cardBulletCore.js";

export { buildCardBriefBullets, type CardBulletBuildInput } from "./buildCardBullets.js";
