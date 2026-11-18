import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  blockBrokerOrdersWhenAuthDisabled,
} from "../../middleware/ordersDisabledWhenAuthOff.js";
import portfolioRouter from "../portfolio.js";

describe("POST /api/portfolio/place-order with AUTH_DISABLED", () => {
  const prevAuth = process.env.AUTH_DISABLED;

  beforeEach(() => {
    process.env.AUTH_DISABLED = "true";
  });

  afterEach(() => {
    if (prevAuth === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prevAuth;
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    const api = express.Router();
    api.use(blockBrokerOrdersWhenAuthDisabled);
    api.use("/portfolio", portfolioRouter);
    app.use("/api", api);
    return app;
  }

  it("returns 403 orders_disabled_no_auth before touching Schwab", async () => {
    const res = await request(buildApp())
      .post("/api/portfolio/place-order")
      .send({
        accountHash: "hash123",
        order: {
          orderType: "MARKET",
          orderLegCollection: [
            { instruction: "BUY", quantity: 1, instrument: { symbol: "SPY", assetType: "EQUITY" } },
          ],
        },
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "orders_disabled_no_auth" });
  });
});