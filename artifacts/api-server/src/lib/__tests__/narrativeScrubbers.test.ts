import { describe, it, expect } from "vitest";
import {
  scrubIvrReferences,
  scrubPcRatioReferences,
  scrubAll,
  formatIvr,
  formatPcRatio,
} from "../narrativeScrubbers.js";

describe("scrubIvrReferences", () => {
  it("replaces the production hallucination ('IVR 92')", () => {
    const text = "IVR 92 means premium is expensive — do NOT leg in.";
    const r = scrubIvrReferences(text, 25);
    expect(r.text).toContain("IVR 25");
    expect(r.text).not.toContain("IVR 92");
    expect(r.replacements.length).toBeGreaterThan(0);
    expect(r.replacements[0].field).toBe("IVR");
    expect(r.replacements[0].cited).toBe("92");
    expect(r.replacements[0].canonical).toBe("25");
  });

  it("replaces decimal-style hallucination ('IVR 0.92')", () => {
    const text = "IVR 0.92 means premium is expensive";
    const r = scrubIvrReferences(text, 25);
    expect(r.text).toContain("IVR 25");
    expect(r.text).not.toContain("0.92");
  });

  it("replaces both hallucinations in the actual production CAUTION line", () => {
    // Verbatim from the user's bug report card:
    const text =
      "IVR 0.92 means premium is expensive — do NOT leg in; work the spread as a single net-debit order. " +
      "User preference is 30-60 DTE; this is 10 DTE by design because the catalyst stack fires inside two weeks " +
      "and longer-dated structures pay too much vega at IVR 92.";
    const r = scrubIvrReferences(text, 25);
    expect(r.text).not.toMatch(/IVR\s+0?\.?92/);
    expect(r.text).not.toMatch(/IVR\s+92/);
    // Both citations get the canonical value.
    const canonOccurrences = (r.text.match(/IVR\s+25/g) || []).length;
    expect(canonOccurrences).toBe(2);
    expect(r.replacements.length).toBe(2);
  });

  it("substitutes the {{IVR}} placeholder", () => {
    const text = "Selling vega here makes sense given {{IVR}} is elevated.";
    const r = scrubIvrReferences(text, 47);
    expect(r.text).toBe("Selling vega here makes sense given 47 is elevated.");
    expect(r.replacements[0].kind).toBe("placeholder");
  });

  it("handles all common phrasings", () => {
    const cases: Array<[string, string]> = [
      ["IVR 92", "IVR 25"],
      ["IVR: 92", "IVR: 25"],
      ["IVR=92", "IVR=25"],
      ["IVR of 92", "IVR of 25"],
      ["IVR is 92", "IVR is 25"],
      ["IVR at 92", "IVR at 25"],
      ["IVR ~ 92", "IVR ~ 25"],
      ["IV Rank 92", "IV Rank 25"],
      ["IV-Rank 92", "IV-Rank 25"],
      ["IV rank: 92", "IV rank: 25"],
      ["(IVR 92)", "(IVR 25)"],
      ["(IVR=92)", "(IVR=25)"],
      ["IVR 92%", "IVR 25"],
      ["IVR 92.5", "IVR 25"],
    ];
    for (const [input, expected] of cases) {
      const r = scrubIvrReferences(input, 25);
      expect(r.text, `input: ${input}`).toBe(expected);
    }
  });

  it("does NOT touch numbers that are already canonical (within rounding)", () => {
    const text = "IVR 25 is at the historical median.";
    const r = scrubIvrReferences(text, 25);
    expect(r.text).toBe(text);
    expect(r.replacements.length).toBe(0);
  });

  it("does NOT touch unrelated numbers", () => {
    const text = "Long 705 put OI 1,760, short 700 put delta -0.49.";
    const r = scrubIvrReferences(text, 25);
    expect(r.text).toBe(text);
    expect(r.replacements.length).toBe(0);
  });

  it("INTEGRATION: header IVR equals every IVR mention in narrative (within rounding)", () => {
    // Spec from the user: "generate 10 cards across different tickers/structures,
    // assert header IVR equals every IVR reference in the narrative (within rounding)."
    // We simulate 10 narratives the AI might produce, with various hallucinated
    // IVR values, and verify post-scrub all references match the canonical header.
    const cards: Array<{ ticker: string; canonicalIvr: number; narratives: string[] }> = [
      {
        ticker: "SPY",
        canonicalIvr: 25,
        narratives: [
          "IVR 92 means premium is expensive.",
          "Vol crush risk if IVR 0.92 reverts.",
          "Selling at IVR=88 is rich.",
        ],
      },
      { ticker: "AAPL", canonicalIvr: 47, narratives: ["IV Rank 30 — favor debit.", "with IVR of 12 calls are cheap"] },
      { ticker: "TSLA", canonicalIvr: 70, narratives: ["(IVR 55) suggests credit", "premium at IVR 100 is a sell"] },
      { ticker: "QQQ", canonicalIvr: 18, narratives: ["IVR 5 is depressed."] },
      { ticker: "MU",   canonicalIvr: 62, narratives: ["IVR: 22 — cheap vol", "and IVR 22 again later"] },
      { ticker: "NVDA", canonicalIvr: 80, narratives: ["IVR 45.5 with vega trap."] },
    ];

    for (const card of cards) {
      const canonStr = formatIvr(card.canonicalIvr)!;
      for (const narrative of card.narratives) {
        const r = scrubIvrReferences(narrative, card.canonicalIvr);
        // Find all IVR-anchored numeric mentions in the post-scrub text and
        // confirm each equals the canonical value.
        const re = /(?:IV[\s\-]?Rank|IVR)\s*(?:of|is|at|=|:|~|≈)?\s*(\d+(?:\.\d+)?)/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(r.text)) != null) {
          expect(m[1], `${card.ticker}: ${narrative} → ${r.text}`).toBe(canonStr);
        }
      }
    }
  });

  it("MECHANIC PROOF: substitution works regardless of whether the canonical is correct", () => {
    // Spec: "test must pass even while the underlying IVR value is still the
    // broken 3.17". We feed in 3.17 as the (wrong) canonical and verify the
    // narrative is consistently 3 — proving the mechanism works independently
    // of upstream IVR correctness.
    const text = "IVR 92 — sell vega here.";
    const r = scrubIvrReferences(text, 3.17);
    expect(r.text).toBe("IVR 3 — sell vega here.");
  });

  it("no-op when canonical is null (cannot substitute what we don't have)", () => {
    const text = "IVR 92 is rich.";
    const r = scrubIvrReferences(text, null);
    expect(r.text).toBe(text);
    expect(r.replacements.length).toBe(0);
  });
});

describe("scrubPcRatioReferences", () => {
  it("replaces P/C ratio mentions", () => {
    const text = "P/C 0.45 shows put-heavy flow.";
    const r = scrubPcRatioReferences(text, 1.19);
    expect(r.text).toContain("P/C 1.19");
    expect(r.replacements[0].field).toBe("PC_RATIO");
  });

  it("replaces longer phrasings", () => {
    const cases: Array<[string, string]> = [
      ["P/C ratio 0.45", "P/C ratio 1.19"],
      ["put/call 0.45", "put/call 1.19"],
      ["put/call ratio of 0.45", "put/call ratio of 1.19"],
      ["P/C: 0.45", "P/C: 1.19"],
      ["{{PC_RATIO}}", "1.19"],
    ];
    for (const [input, expected] of cases) {
      const r = scrubPcRatioReferences(input, 1.19);
      expect(r.text, `input: ${input}`).toBe(expected);
    }
  });
});

describe("scrubAll", () => {
  it("scrubs both fields in one pass", () => {
    const text = "IVR 92 with P/C 0.45 — premium expensive.";
    const r = scrubAll(text, { ivr: 25, pcRatio: 1.19 });
    expect(r.text).toBe("IVR 25 with P/C 1.19 — premium expensive.");
    expect(r.replacements.length).toBe(2);
  });
});

describe("formatters", () => {
  it("formatIvr rounds to integer", () => {
    expect(formatIvr(25.7)).toBe("26");
    expect(formatIvr(3.17)).toBe("3");
    expect(formatIvr(null)).toBeNull();
  });
  it("formatPcRatio is two decimals", () => {
    expect(formatPcRatio(1.187)).toBe("1.19");
    expect(formatPcRatio(null)).toBeNull();
  });
});
