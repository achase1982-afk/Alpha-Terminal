import { describe, expect, it } from "vitest";
import { atLadderSkeletonStrikes } from "../atLadderSkeletonStrikes";

describe("atLadderSkeletonStrikes", () => {
  it("centers on underlying", () => {
    const rows = atLadderSkeletonStrikes(7340.53);
    expect(rows).toContain(7340);
    expect(rows[0] - rows[rows.length - 1]).toBe(50);
  });
});