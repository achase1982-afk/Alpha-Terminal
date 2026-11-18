import { describe, expect, it, vi, beforeEach } from "vitest";
import { useTerminalStore } from "../store";
import { SERVER_BROKERAGE_SENTINEL } from "../schwabBrokerageSession";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("@/lib/authMode", () => ({
  isAuthDisabled: vi.fn(() => true),
}));

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { syncSchwabTokensFromServer } from "../schwabTokenSync";

describe("syncSchwabTokensFromServer (auth disabled)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => null,
    });
    useTerminalStore.getState().clearTokens();
    useTerminalStore.getState().clearTraderTokens();
    vi.mocked(fetchWithAuth).mockReset();
  });

  it("hydrates server sentinel when server-tokens reports connected without raw tokens", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: async () => ({
        market: { connected: true, expiresAt: Date.now() + 60_000 },
        trader: null,
      }),
    } as Response);

    const ok = await syncSchwabTokensFromServer();
    expect(ok).toBe(true);
    const state = useTerminalStore.getState();
    expect(state.accessToken).toBe(SERVER_BROKERAGE_SENTINEL);
    expect(state.traderAccessToken).toBe(SERVER_BROKERAGE_SENTINEL);
    expect(state.refreshToken).toBe("");
  });
});