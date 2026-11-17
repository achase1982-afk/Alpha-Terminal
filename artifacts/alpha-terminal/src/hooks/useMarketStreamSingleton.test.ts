import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

describe("useMarketStream singleton", () => {
  it("only Terminal mounts useMarketStream", () => {
    const orderTicket = readFileSync(join(root, "components/OrderTicket.tsx"), "utf8");
    const strategyBuilder = readFileSync(join(root, "components/StrategyBuilder.tsx"), "utf8");
    const terminal = readFileSync(join(root, "pages/Terminal.tsx"), "utf8");
    expect(orderTicket).not.toMatch(/\buseMarketStream\s*\(/);
    expect(strategyBuilder).not.toMatch(/\buseMarketStream\s*\(/);
    expect(terminal).toMatch(/\buseMarketStream\s*\(/);
  });
});
