import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async () => {
  // ivNormalize imports `and` / `desc` / `eq` / `sql` via @workspace/db; forward the real builders.
  const { and, desc, eq, sql } = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  const equityDailyTable = {
    symbol: "symbol",
    date: "date",
    close: "close",
    iv30d: "iv30d",
    iv30dProxy: "iv30dProxy",
    ivr: "ivr",
    ivrSource: "ivrSource",
  };

  const queryResults: unknown[][] = [];
  const db = {
    __setQueryResults(results: unknown[][]) {
      queryResults.length = 0;
      queryResults.push(...results);
    },
    select() {
      return {
        from() {
          return {
            where() {
              const resolveNext = () => Promise.resolve(queryResults.shift() ?? []);
              return {
                then(resolve: (value: unknown[]) => void, reject?: (reason: unknown) => void) {
                  return resolveNext().then(resolve, reject);
                },
                orderBy() {
                  return {
                    limit() {
                      return resolveNext();
                    },
                  };
                },
                limit() {
                  return resolveNext();
                },
              };
            },
          };
        },
      };
    },
  };

  return { db, equityDailyTable, optionsChainDailyTable: {}, optionsFlowPerStrikeTable: {}, and, desc, eq, sql };
});

import { db } from "@workspace/db";
import { computeIVRForSymbol } from "../ivNormalize.js";

describe("computeIVRForSymbol", () => {
  it("ignores chain IV override when IVR history is proxy-based", async () => {
    (db as unknown as { __setQueryResults(results: unknown[][]): void }).__setQueryResults([
      [{ c: 6 }],      // real IV history is insufficient
      [{ c: 60 }],     // proxy history is sufficient
      [{ iv: 0.53, ivProxy: 0.21 }],
      Array.from({ length: 60 }, (_, i) => ({ iv: 0.20 + i * 0.001 })),
    ]);

    const ivr = await computeIVRForSymbol("AAPL", "2026-04-28", 0.53);

    expect(ivr).toBeLessThan(30);
  });
});
