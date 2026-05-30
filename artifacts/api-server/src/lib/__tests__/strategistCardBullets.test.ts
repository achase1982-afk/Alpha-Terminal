import { describe, it, expect } from "vitest";
import {
  CARD_BULLET_MAX_CHARS,
  CARD_BULLET_MAX_WORDS,
  buildCardBriefBullets,
  cardBulletSchema,
  compressCardBullet,
  enforceCardBullets,
  proseToCardBullets,
  tightenCardBullet,
  validateCardBullet,
} from "@workspace/strategist-card-bullets";

describe("validateCardBullet", () => {
  it("accepts a compliant bullet with levels and IVR", () => {
    const r = validateCardBullet("DELL IVR 72 — sell rich premium");
    expect(r.ok).toBe(true);
  });

  it("tightens wrap-prone prose to max words and chars", () => {
    const tightened = tightenCardBullet(
      "While front-month implied volatility is highly elevated with an IVR",
    );
    expect(tightened).not.toBeNull();
    if (tightened) {
      expect(tightened.length).toBeLessThanOrEqual(CARD_BULLET_MAX_CHARS);
      expect(tightened.split(/\s+/).length).toBeLessThanOrEqual(CARD_BULLET_MAX_WORDS);
    }
    const words = Array.from({ length: 12 }, (_, i) => `token${i}`).join(" ");
    expect(tightenCardBullet(words)?.split(/\s+/).length ?? 0).toBeLessThanOrEqual(CARD_BULLET_MAX_WORDS);
  });
});

describe("compressCardBullet", () => {
  it("compresses long kill prose to one line", () => {
    const out = compressCardBullet(
      "The single biggest threat is a sudden macro-driven market correction",
    );
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
      "Spot $428 above $425 short put",
      "Profit target at 62% ($0.80) — too specific for card",
    ]);
    expect(out.length).toBeGreaterThan(0);
    for (const b of out) {
      expect(cardBulletSchema.safeParse(b).success).toBe(true);
    }
  });
});

describe("buildCardBriefBullets", () => {
  it("builds data-driven why/kill for a bull put credit", () => {
    const brief = buildCardBriefBullets({
      ticker: "DELL",
      direction: "BULLISH",
      spot: 428,
      ivr: 72,
      pcRatio: 0.62,
      shortStrike: 425,
      shortType: "put",
      breakeven: 418,
      dte: 28,
      catalystDate: "2026-05-28",
      catalystType: "EARNINGS",
      catalystAlignment: "ALIGNED",
      dailyChangePct: 2.4,
      idioPct: 68,
      relativeVolume: 1.6,
      earningsDate: null,
      thesis: "Credit spread on elevated IV.",
      bullInvalidation: "Break below $425 short put.",
      bearInvalidation: "Hold above $425 through expiry.",
      riskOfRuin: "Macro gap through structure.",
      warnings: null,
    });
    expect(brief.whyItWorks.length).toBeGreaterThan(0);
    expect(brief.whatKillsIt.length).toBeGreaterThan(0);
    for (const b of [...brief.whyItWorks, ...brief.whatKillsIt]) {
      expect(b.length).toBeLessThanOrEqual(CARD_BULLET_MAX_CHARS);
      expect(b.split(/\s+/).length).toBeLessThanOrEqual(CARD_BULLET_MAX_WORDS);
    }
    expect(brief.whyItWorks.some((b) => /IVR|425|call flow/i.test(b))).toBe(true);
    expect(brief.whatKillsIt.some((b) => /below|breakeven|macro/i.test(b))).toBe(true);
  });
});

describe("proseToCardBullets", () => {
  it("splits prose into compliant bullets", () => {
    const bullets = proseToCardBullets(
      "Edge from elevated implied vol. Thesis needs price to hold support.",
    );
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(6);
  });
});

describe("tightenCardBullet", () => {
  it("strips header symbols", () => {
    expect(tightenCardBullet("▲ Hold above short strike zone")).toBe("Hold above short strike zone");
  });
});
