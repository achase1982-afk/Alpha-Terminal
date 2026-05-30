import { describe, it, expect } from "vitest";
import { scrubAll } from "../narrativeScrubbers.js";
import {
  CARD_BULLET_MAX_CHARS,
  CARD_BULLET_MAX_COUNT,
  CARD_BULLET_MAX_WORDS,
  cardBulletSchema,
  compressCardBullet,
  enforceCardBullets,
  proseToCardBullets,
  resolveCardBullets,
  tightenCardBullet,
  validateCardBullet,
  validateCardFaceBulletsFromAi,
} from "@workspace/strategist-card-bullets";

describe("validateCardBullet", () => {
  it("accepts a compliant bullet with levels and IVR", () => {
    const r = validateCardBullet("DELL IVR 72 — sell rich premium");
    expect(r.ok).toBe(true);
  });

  it("rejects narrative placeholders and joined ideas", () => {
    expect(validateCardBullet("DELL {{IVR}} — sell premium").ok).toBe(false);
    expect(validateCardBullet("Rich premium + firm tape").ok).toBe(false);
    expect(validateCardBullet("Vol regime, macro gap").ok).toBe(false);
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

describe("resolveCardBullets", () => {
  it("prefers valid AI bullets over prose fallback", () => {
    const r = resolveCardBullets({
      direction: "BULLISH",
      whyBulletsFromAi: ["May 28 earnings drift supports hold", "DELL IVR 72 — sell premium"],
      whatKillsBulletsFromAi: ["Close below $425 kills bull put", "Macro gap flips thesis"],
      thesis: "Long thesis prose.",
      bullInvalidation: "Break below.",
      bearInvalidation: "Hold above.",
      riskOfRuin: "Gap risk.",
      warnings: null,
    });
    expect(r.source).toBe("ai");
    expect(r.whyItWorks[0]).toContain("earnings");
  });

  it("falls back to clipped prose when AI bullets missing", () => {
    const r = resolveCardBullets({
      direction: "BULLISH",
      whyBulletsFromAi: [],
      whatKillsBulletsFromAi: [],
      thesis: "Credit spread captures elevated implied volatility premium.",
      bullInvalidation: "Break below short strike invalidates.",
      bearInvalidation: "Hold above short strike.",
      riskOfRuin: "Macro selloff.",
      warnings: null,
    });
    expect(r.source).toBe("prose_fallback");
    expect(r.whyItWorks.length).toBeGreaterThan(0);
  });
});

describe("validateCardFaceBulletsFromAi", () => {
  it("requires at least two valid bullets per section", () => {
    expect(
      validateCardFaceBulletsFromAi(["One valid bullet only here"], ["Close below $425", "Macro gap risk"]).ok,
    ).toBe(false);
  });

  it("flags placeholder tokens before scrub", () => {
    const r = validateCardFaceBulletsFromAi(
      ["DELL {{IVR}} — sell premium", "May 28 earnings drift supports hold"],
      ["Close below $425", "Macro gap flips thesis"],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.includes("placeholder"))).toBe(true);
  });
});

describe("proseToCardBullets", () => {
  it("splits prose into compliant bullets", () => {
    const bullets = proseToCardBullets(
      "Edge from elevated implied vol. Thesis needs price to hold support.",
    );
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(CARD_BULLET_MAX_COUNT);
  });
});

describe("card bullet IVR scrub path", () => {
  it("substitutes {{IVR}} with canonical value for card display", () => {
    const r = scrubAll("DELL {{IVR}} — sell rich premium", { ivr: 72, pcRatio: null });
    expect(r.text).not.toContain("{{IVR}}");
    expect(r.text).toContain("72");
    expect(validateCardBullet(r.text).ok).toBe(true);
  });
});

describe("tightenCardBullet", () => {
  it("strips header symbols", () => {
    expect(tightenCardBullet("▲ Hold above short strike zone")).toBe("Hold above short strike zone");
  });
});
