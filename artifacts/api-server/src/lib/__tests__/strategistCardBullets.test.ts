import { describe, it, expect } from "vitest";
import {
  CARD_BULLET_MAX_CHARS,
  CARD_BULLET_MAX_WORDS,
  buildCardBriefBullets,
  cardBulletSchema,
  compressCardBullet,
  enforceCardBullets,
  proseToCardBullets,
  validateCardBullet,
} from "@workspace/strategist-card-bullets";

describe("validateCardBullet", () => {
  it("accepts a compliant bullet", () => {
    const r = validateCardBullet("Defined risk with favorable skew");
    expect(r.ok).toBe(true);
  });

  it("rejects digits, parentheses, and length", () => {
    expect(validateCardBullet("OI 12,000 on short leg").ok).toBe(false);
    expect(validateCardBullet("Break below $95 (invalidates)").ok).toBe(false);
    expect(
      validateCardBullet(
        "This bullet is intentionally far too long to sit on the trade card face",
      ).ok,
    ).toBe(false);
  });

  it("rejects more than ten words", () => {
    const words = Array.from({ length: 11 }, (_, i) => `word${i}`).join(" ");
    expect(validateCardBullet(words).ok).toBe(false);
  });
});

describe("compressCardBullet", () => {
  it("strips numbers and parentheses via retry", () => {
    const out = compressCardBullet(
      "Break below $95 (invalidates spread) on heavy volume.",
    );
    expect(out).not.toBeNull();
    expect(cardBulletSchema.safeParse(out).success).toBe(true);
  });

  it("truncates to max words and chars", () => {
    const long =
      "Momentum supports the structure while implied volatility remains elevated versus realized and skew favors premium sellers";
    const out = compressCardBullet(long);
    expect(out).not.toBeNull();
    if (out) {
      expect(out.length).toBeLessThanOrEqual(CARD_BULLET_MAX_CHARS);
      expect(out.split(/\s+/).length).toBeLessThanOrEqual(CARD_BULLET_MAX_WORDS);
    }
  });
});

describe("enforceCardBullets", () => {
  it("returns only schema-valid bullets after compress/retry", () => {
    const out = enforceCardBullets([
      "Valid skew versus street expectations",
      "Profit target at 62% ($0.80) — too specific for card",
    ]);
    expect(out.length).toBeGreaterThan(0);
    for (const b of out) {
      expect(cardBulletSchema.safeParse(b).success).toBe(true);
    }
  });
});

describe("buildCardBriefBullets", () => {
  it("returns schema-valid why/kill lists", () => {
    const brief = buildCardBriefBullets({
      thesis:
        "Credit spread captures elevated IV. Target 62% of max profit near $0.50 buyback.",
      bullInvalidation: "Hold above short strike through expiration week.",
      bearInvalidation:
        "Break below $95 (invalidates) with rising put skew and volume.",
      riskOfRuin: "Gap risk on earnings within DTE window.",
      warnings: "Low open interest on long wing (liquidity risk).",
    });
    for (const b of [...brief.whyItWorks, ...brief.whatKillsIt]) {
      expect(b.length).toBeLessThanOrEqual(CARD_BULLET_MAX_CHARS);
      expect(b).not.toMatch(/\d/);
      expect(b).not.toMatch(/[()]/);
      expect(b.split(/\s+/).length).toBeLessThanOrEqual(CARD_BULLET_MAX_WORDS);
    }
  });
});

describe("proseToCardBullets", () => {
  it("splits prose into compliant bullets", () => {
    const bullets = proseToCardBullets(
      "Edge from elevated implied vol. Thesis needs price to hold support. Second idea stands alone.",
    );
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(6);
  });
});
