import { describe, expect, it } from "vitest";
import { redactTelemetryDetails, redactTelemetryString } from "../telemetryRedact.js";

describe("telemetryRedact", () => {
  it("redacts sensitive object keys recursively", () => {
    const out = redactTelemetryDetails({
      access_token: "secret",
      nested: { refresh_token: "rt", ok: 1 },
      authorization: "Bearer x",
    });
    expect(out).toEqual({
      access_token: "[REDACTED]",
      nested: { refresh_token: "[REDACTED]", ok: 1 },
      authorization: "[REDACTED]",
    });
  });

  it("strips token-like query params from URLs", () => {
    const s = redactTelemetryString("/api/ws/prices?clerk_token=abc123&foo=1");
    expect(s).toContain("clerk_token=[REDACTED]");
    expect(s).not.toContain("abc123");
    expect(s).toContain("foo=1");
  });
});