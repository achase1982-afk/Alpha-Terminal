import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const hookSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../useMarketStream.ts"),
  "utf8",
);

describe("useMarketStream connect guard", () => {
  it("uses a single in-flight guard, post-auth generation check, and owning-socket ref clear", () => {
    expect(hookSrc).toMatch(/wsConnectInFlightRef/);
    expect(hookSrc).toMatch(/wsConnectGenRef/);
    expect(hookSrc).toMatch(/connectGen !== wsConnectGenRef\.current/);
    expect(hookSrc).toMatch(/if \(wsRef\.current === socket\)/);
  });
});