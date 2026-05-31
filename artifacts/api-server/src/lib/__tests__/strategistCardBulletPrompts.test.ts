import { describe, it, expect } from "vitest";
import {
  CARD_FACE_BULLET_PROMPT,
  SOLO_DESK_CARD_BULLET_PROMPT,
  CONVICTION_DESK_CARD_BULLET_PROMPT,
} from "@workspace/strategist-card-bullets";
import { buildPmPrompt } from "../strategistDeskPrompts.js";
import { buildConvictionDeskStaticUserPrefix } from "../convictionDeskXmlPrompt.js";

const FORBIDDEN_STRUCTURE_PHRASES = [
  "breakeven",
  "max loss",
  "short put below spot",
  "trade structure",
  "invent bullets from leg math",
];

describe("card bullet prompts — thesis-only sourcing", () => {
  it("V2 CARD_FACE_BULLET_PROMPT forbids structure readouts and cites thesis fields", () => {
    const p = CARD_FACE_BULLET_PROMPT;
    for (const phrase of FORBIDDEN_STRUCTURE_PHRASES) {
      expect(p.toLowerCase()).toContain(phrase.toLowerCase());
    }
    expect(p).toContain("whyBullets");
    expect(p).toContain("whatKillsBullets");
    expect(p).toContain("thesis");
    expect(p).toContain("riskOfRuin");
  });

  it("Solo Desk PM prompt embeds SOLO_DESK_CARD_BULLET_PROMPT and why_bullets fields", () => {
    const pmPrompt = buildPmPrompt("{}", "vol read", "flow read", "catalyst read");
    expect(pmPrompt).toContain(SOLO_DESK_CARD_BULLET_PROMPT.trim().slice(0, 40));
    expect(pmPrompt).toContain("why_bullets");
    expect(pmPrompt).toContain("what_kills_bullets");
    expect(pmPrompt).toContain("pm.thesis");
    expect(pmPrompt).toContain("pm.biggest_risk");
  });

  it("Conviction Desk static prefix embeds CONVICTION_DESK_CARD_BULLET_PROMPT", () => {
    const prefix = buildConvictionDeskStaticUserPrefix({
      volSectionGuidance: "vol guidance",
      flowSectionGuidance: "flow guidance",
      catalystSectionGuidance: "catalyst guidance",
      decisionSectionGuidance: "decision guidance",
      webSearchGuidanceBlock: "",
    });
    expect(prefix).toContain(CONVICTION_DESK_CARD_BULLET_PROMPT.trim().slice(0, 40));
    expect(prefix).toContain("regime_synthesis");
    expect(prefix).toContain("why_bullets");
    expect(prefix).toContain("what_kills_bullets");
  });
});

/** Sample post-prompt PM bullets (Solo Desk) — no structure tautologies. */
export const SOLO_DESK_SAMPLE_BULLETS = {
  why_bullets: [
    "Post-earnings drift after May 28 beat",
    "Vol still rich vs realized after gap",
    "Call flow confirms post-print chase",
  ],
  what_kills_bullets: [
    "Jun 17 FOMC shock reprices vol up",
    "AI server demand reversal kills bull",
    "Guidance cut on next print",
  ],
};

/** Sample post-prompt PM bullets (Conviction Desk). */
export const CONVICTION_DESK_SAMPLE_BULLETS = {
  why_bullets: [
    "PM synthesis: sponsor tape post-print",
    "Family fit: defined-risk bull expression",
    "Mispricing: front IV vs realized gap",
  ],
  what_kills_bullets: [
    "Risk of ruin: macro vol spike",
    "Unfit if tape flips to distribution",
    "Catalyst slip breaks vol sale thesis",
  ],
};

function bulletLooksLikeStructureReadout(b: string): boolean {
  return (
    /\b(short put|long put|short call|breakeven|max loss|max profit|sits below spot|below spot|above spot)\b/i.test(
      b,
    ) || /\$\d+.*\b(strike|put|call)\b/i.test(b)
  );
}

describe("sample desk bullets (fixture — post-prompt quality)", () => {
  it("Solo Desk sample bullets avoid structure readouts", () => {
    for (const b of [
      ...SOLO_DESK_SAMPLE_BULLETS.why_bullets,
      ...SOLO_DESK_SAMPLE_BULLETS.what_kills_bullets,
    ]) {
      expect(bulletLooksLikeStructureReadout(b)).toBe(false);
    }
  });

  it("Conviction Desk sample bullets avoid structure readouts", () => {
    for (const b of [
      ...CONVICTION_DESK_SAMPLE_BULLETS.why_bullets,
      ...CONVICTION_DESK_SAMPLE_BULLETS.what_kills_bullets,
    ]) {
      expect(bulletLooksLikeStructureReadout(b)).toBe(false);
    }
  });
});
