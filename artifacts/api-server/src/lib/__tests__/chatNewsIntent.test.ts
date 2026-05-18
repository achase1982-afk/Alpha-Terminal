import { describe, expect, it } from "vitest";
import { routingTextWantsNewsOrCatalyst } from "../aiChatContextPack.js";

describe("routingTextWantsNewsOrCatalyst", () => {
  it("detects headline / catalyst phrasing", () => {
    expect(routingTextWantsNewsOrCatalyst("Any headlines on NOW?")).toBe(true);
    expect(routingTextWantsNewsOrCatalyst("What news is driving this move?")).toBe(true);
    expect(routingTextWantsNewsOrCatalyst("Why is the stock ripping")).toBe(true);
    expect(routingTextWantsNewsOrCatalyst("SEC filing today?")).toBe(true);
  });

  it("does not fire on pure tape / flow questions", () => {
    expect(routingTextWantsNewsOrCatalyst("What's the tape looking like?")).toBe(false);
    expect(routingTextWantsNewsOrCatalyst("Show me the 105 calls")).toBe(false);
  });
});
