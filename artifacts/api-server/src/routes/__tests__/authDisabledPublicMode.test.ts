import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const tokenMocks = vi.hoisted(() => ({
  hasValidTokens: vi.fn(() => true),
  getTokens: vi.fn(() => ({
    accessToken: "secret-access-token-do-not-leak",
    refreshToken: "secret-refresh-token-do-not-leak",
    expiresAt: Date.now() + 60_000,
    refreshIssuedAt: 1,
    refreshExpiresAt: Date.now() + 7 * 86400000,
  })),
  getSchwab2TokenMeta: vi.fn(() => ({
    has_tokens: false,
    access_token_expires_at: null,
    refresh_token_issued_at: null,
    refresh_token_expires_at: null,
  })),
}));

vi.mock("../../lib/tokenStore.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/tokenStore.js")>();
  return {
    ...orig,
    hasValidTokens: tokenMocks.hasValidTokens,
    getTokens: tokenMocks.getTokens,
    storeTokens: vi.fn(),
    clearTokens: vi.fn(),
    getRefreshToken: vi.fn(),
    forceRefresh: vi.fn(),
  };
});

vi.mock("../../lib/desk/deskSchwab2TokenStore.js", () => ({
  getSchwab2TokenMeta: tokenMocks.getSchwab2TokenMeta,
}));

vi.mock("../../lib/desk/deskSchwab2OAuth.js", () => ({
  deskSchwab2Configured: () => false,
  buildSchwab2AuthorizeUrl: () => null,
}));

vi.mock("../../lib/schwabStreamer.js", () => ({
  stopStreamer: vi.fn(),
}));

import authRouter from "../auth.js";

describe("auth reviewer mode (AUTH_DISABLED)", () => {
  const prev = process.env.AUTH_DISABLED;

  beforeEach(() => {
    process.env.AUTH_DISABLED = "true";
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prev;
  });

  function app() {
    const a = express();
    a.use(express.json());
    a.use("/auth", authRouter);
    return a;
  }

  it("GET /auth/server-tokens omits raw access and refresh tokens", async () => {
    const res = await request(app()).get("/auth/server-tokens");
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/secret-access-token/);
    expect(body).not.toMatch(/secret-refresh-token/);
    expect(body).not.toContain("accessToken");
    expect(body).not.toContain("refreshToken");
    expect(res.body.market?.connected).toBe(true);
    expect(res.body.trader?.connected).toBe(true);
  });

  it("blocks client token refresh and pending-session handoff", async () => {
    const refresh = await request(app()).post("/auth/refresh").send({ refreshToken: "x" });
    expect(refresh.status).toBe(403);
    expect(refresh.body.error).toBe("auth_disabled");

    const pending = await request(app()).get("/auth/pending-session");
    expect(pending.status).toBe(403);

    const disconnect = await request(app()).post("/auth/disconnect");
    expect(disconnect.status).toBe(403);
  });
});