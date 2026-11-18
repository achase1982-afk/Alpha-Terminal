/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadActiveTraderPrefs,
  saveActiveTraderPrefs,
  type ActiveTraderTemplatePrefs,
} from "../activeTraderPrefs";

const STORAGE_KEY = "activeTraderPrefs:v6";

describe("activeTraderPrefs persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("never persists or restores autoSend.armed", () => {
    const armed: ActiveTraderTemplatePrefs = {
      ...loadActiveTraderPrefs("index"),
      autoSend: { enabled: true, armed: true },
    };
    saveActiveTraderPrefs("index", armed);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      ActiveTraderTemplatePrefs
    >;
    expect(raw.index.autoSend.armed).toBe(false);
    expect(loadActiveTraderPrefs("index").autoSend.armed).toBe(false);
    expect(loadActiveTraderPrefs("index").autoSend.enabled).toBe(true);
  });
});