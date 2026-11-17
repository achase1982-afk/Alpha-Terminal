import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESK_UW_AUTH_BACKOFF_MS,
  deskUwPollPaused,
  deskUwRecordHttpStatus,
  deskUwResetPollControlForTests,
} from "../deskUwPollControl.js";

describe("deskUwPollControl", () => {
  beforeEach(() => {
    deskUwResetPollControlForTests();
    vi.useRealTimers();
  });

  it("pauses 30 minutes after 402", () => {
    deskUwRecordHttpStatus(402);
    expect(deskUwPollPaused()).toBe(true);
    const resumeAt = Date.now() + DESK_UW_AUTH_BACKOFF_MS - 1000;
    expect(deskUwPollPaused(resumeAt)).toBe(true);
  });

  it("honors Retry-After on 429", () => {
    deskUwRecordHttpStatus(429, 120);
    expect(deskUwPollPaused(Date.now() + 60_000)).toBe(true);
    expect(deskUwPollPaused(Date.now() + 130_000)).toBe(false);
  });
});
