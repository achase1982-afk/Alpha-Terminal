import { describe, it, expect } from "vitest";
import { scrubAll } from "../narrativeScrubbers.js";
import {
  CARD_BULLET_MAX_COUNT,
  cardBulletLooksLikeDataReadout,
  cardBulletLacksLossCondition,
  compressCardBullet,
  enforceCardBullets,
  proseToCardBullets,
  resolveCardBullets,
  normalizeCardBullet,
  validateCardBullet,
  validateCardFaceBulletsFromAi,
} from "@workspace/strategist-card-bullets";

describe("validateCardBullet", () => {
  it("accepts a profit claim with implication", () => {
    const r = validateCardBullet(
      "Rich implied vol lets us finance upside without paying full ATM premium",
      "why",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects narrative placeholders and joined ideas", () => {
    expect(validateCardBullet("DELL {{IVR}} — sell premium", "why").ok).toBe(false);
    expect(validateCardBullet("Rich premium + firm tape", "why").ok).toBe(false);
    expect(validateCardBullet("Vol regime, macro gap", "why").ok).toBe(false);
  });

  it("rejects data readouts on why bullets", () => {
    expect(validateCardBullet("IVR 72", "why").ok).toBe(false);
    expect(validateCardBullet("short put 25-delta", "why").ok).toBe(false);
    expect(
      validateCardBullet("Short strike is far enough OTM that expiry worthless is the base case", "why").ok,
    ).toBe(true);
  });

  it("requires loss conditions on kill bullets", () => {
    expect(validateCardBullet("IV crush", "kill").ok).toBe(false);
    expect(validateCardBullet("Close below $425 kills the bull put credit", "kill").ok).toBe(true);
  });

  it("allows long bullets without a character cap", () => {
    const long =
      "Post-earnings drift and a still-supportive tape mean we can hold this butterfly through the catalyst window without overpaying for gamma";
    const tightened = normalizeCardBullet(long);
    expect(tightened).not.toBeNull();
    if (tightened) {
      expect(tightened.length).toBeGreaterThan(50);
      expect(validateCardBullet(tightened, "why").ok).toBe(true);
    }
  });
});

describe("cardBullet heuristics", () => {
  it("flags stat-only why lines", () => {
    expect(cardBulletLooksLikeDataReadout("IVR 37")).toBe(true);
    expect(cardBulletLooksLikeDataReadout("IVR 37 favors financed upside")).toBe(false);
  });

  it("flags kill lines without a loss condition", () => {
    expect(cardBulletLacksLossCondition("Macro headwind")).toBe(true);
    expect(cardBulletLacksLossCondition("Gap below short put invalidates the spread")).toBe(false);
  });
});

describe("compressCardBullet", () => {
  it("compresses long kill prose to one line", () => {
    const out = compressCardBullet(
      "The single biggest threat is a sudden macro-driven market correction that gaps through support",
      "kill",
    );
    expect(out).not.toBeNull();
  });
});

describe("enforceCardBullets", () => {
  it("returns only schema-valid bullets after compress/retry", () => {
    const out = enforceCardBullets(
      [
        "Rich vol lets us sell premium with a high probability of keeping the credit",
        "Profit target at 62% is too specific for card",
      ],
      undefined,
      "why",
    );
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("resolveCardBullets", () => {
  it("prefers valid AI bullets over prose fallback", () => {
    const r = resolveCardBullets({
      direction: "BULLISH",
      whyBulletsFromAi: [
        "Earnings drift still favors holding through this expiry window",
        "Short strike OTM enough that keeping premium is the base case",
      ],
      whatKillsBulletsFromAi: [
        "Close below short put strike and the credit spread loses max",
        "Macro gap flips the thesis and wipes the position",
      ],
      thesis: "Long thesis prose.",
      bullInvalidation: "Break below.",
      bearInvalidation: "Hold above.",
      riskOfRuin: "Gap risk.",
      warnings: null,
    });
    expect(r.source).toBe("ai");
    expect(r.whyItWorks[0]).toContain("Earnings");
  });

  it("falls back to clipped prose when AI bullets missing", () => {
    const r = resolveCardBullets({
      direction: "BULLISH",
      whyBulletsFromAi: [],
      whatKillsBulletsFromAi: [],
      thesis: "Credit spread captures elevated implied volatility premium when vol is rich.",
      bullInvalidation: "Break below short strike invalidates the credit spread.",
      bearInvalidation: "Hold above short strike.",
      riskOfRuin: "Macro selloff gaps through structure.",
      warnings: null,
    });
    expect(r.source).toBe("prose_fallback");
    expect(r.whyItWorks.length + r.whatKillsIt.length).toBeGreaterThan(0);
  });
});

describe("validateCardFaceBulletsFromAi", () => {
  it("requires at least two valid bullets per section", () => {
    expect(
      validateCardFaceBulletsFromAi(
        ["One valid profit claim only here today"],
        ["Close below $425 kills spread", "Macro gap flips thesis"],
      ).ok,
    ).toBe(false);
  });

  it("flags placeholder tokens before scrub", () => {
    const r = validateCardFaceBulletsFromAi(
      ["DELL {{IVR}} — sell premium", "Earnings drift still supports holding through expiry"],
      ["Close below $425", "Macro gap flips thesis"],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.includes("placeholder"))).toBe(true);
  });

  it("flags data readouts on why bullets", () => {
    const r = validateCardFaceBulletsFromAi(
      ["IVR 72", "Rich vol lets us finance upside without overpaying ATM"],
      ["Close below short put kills max profit", "Headlines reverse and gap through body"],
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.includes("so what"))).toBe(true);
  });
});

describe("proseToCardBullets", () => {
  it("splits prose into compliant bullets", () => {
    const bullets = proseToCardBullets(
      "Rich vol lets us keep the credit if price holds. Thesis needs price to hold support or we lose.",
      4,
      "why",
    );
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(CARD_BULLET_MAX_COUNT);
  });
});

describe("card bullet IVR scrub path", () => {
  it("substitutes {{IVR}} with canonical value for card display", () => {
    const r = scrubAll("Rich vol at {{IVR}} lets us sell premium with edge", { ivr: 72, pcRatio: null });
    expect(r.text).not.toContain("{{IVR}}");
    expect(r.text).toContain("72");
    expect(validateCardBullet(r.text, "why").ok).toBe(true);
  });
});
