import { describe, expect, it, afterEach } from "vitest";
import { deskEnvTruthyDefault } from "../deskEnv.js";

describe("deskEnvTruthyDefault", () => {
  const key = "DESK_TAPE_UNIVERSE_ENABLED";

  afterEach(() => {
    delete process.env[key];
  });

  it("defaults to true when unset", () => {
    expect(deskEnvTruthyDefault(true, key)).toBe(true);
  });

  it("respects explicit false", () => {
    process.env[key] = "false";
    expect(deskEnvTruthyDefault(true, key)).toBe(false);
  });
});