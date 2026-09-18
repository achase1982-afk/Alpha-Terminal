import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getDefaults, getSettingMeta } from "../strategistSettings.js";

const libDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => readFileSync(join(libDir, f), "utf8");

/**
 * The strategist prompts used to tell the model where to aim its confidence
 * number and how often to decline. Both are priors on the output rather than
 * instructions about reasoning, and both survive rewording easily, so they are
 * pinned here as text assertions.
 */
describe("strategist prompts carry no pass bias", () => {
  const strategist = read("strategistV2.ts");
  const desk = read("strategistDeskPrompts.ts");

  it("never tells the model to aim its confidence below the gate", () => {
    expect(strategist).not.toMatch(/return confidence below 20/i);
    expect(strategist).not.toMatch(/Return confidence < 20/i);
    expect(strategist).not.toMatch(/return below 20/i);
  });

  it("never instructs a confidence bump for an aligned catalyst", () => {
    expect(strategist).not.toMatch(/Bump confidence upward/i);
    expect(strategist).not.toMatch(/\+10-15%/);
  });

  it("asks what the market has already priced instead", () => {
    expect(strategist).toMatch(/already priced/i);
    expect(strategist).toMatch(/positioning and crowding context/i);
  });

  it("sets no prior on how often the desk should decline", () => {
    expect(desk).not.toMatch(/Most runs should pass/i);
    expect(desk).toMatch(/pass rate is an output, not a target/i);
  });

  it("describes confidence as a calibrated probability", () => {
    expect(strategist).toMatch(/calibrated probability/i);
  });
});

describe("minimum confidence is a setting, not a literal", () => {
  it("defaults to the old hardcoded threshold so behavior is unchanged out of the box", () => {
    expect(getDefaults().strategistMinConfidence).toBe(20);
  });

  it("is exposed as a tunable with a sane range", () => {
    const meta = getSettingMeta().find((m) => m.key === "strategistMinConfidence");
    expect(meta).toBeDefined();
    expect(meta!.min).toBe(0);
    expect(meta!.max).toBe(60);
    expect(meta!.group).toBe("Strategy");
  });

  it("no longer hardcodes the gate value in the pipeline", () => {
    const strategist = read("strategistV2.ts");
    expect(strategist).toMatch(/aiResponse\.confidence < minConfidence/);
    expect(strategist).not.toMatch(/aiResponse\.confidence < 20/);
  });
});
