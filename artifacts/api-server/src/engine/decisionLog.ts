/**
 * Decision-log bridge for the DETERMINISTIC engine.
 *
 * Writes entry/exit rows into the same `auto_trade_decisions` table the LLM
 * engine uses, so the Auto Trader "Recent Decisions" UI shows price + reason for
 * both engines. No-ops when the engine wasn't started with a user (e.g. via the
 * raw /engine/control route) since rows are user-scoped.
 */
import { logger } from "../lib/logger.js";
import { state } from "./state.js";

export interface EngineDecision {
  ticker: string;
  decision: string;          // "ENTER" | "EXIT" | "FLATTEN_CLOSE" | "STOP_EXIT"
  reasoning: string;
  quantity?: number;
  notional?: number;         // entry rows: entryPrice × qty (UI derives price)
  exitPrice?: number;        // exit rows
  pnl?: number;              // exit rows
  orderId?: string | null;
  placed?: boolean;
  error?: string | null;
}

/**
 * Best-effort: never throws into the hot loop. The DB writer is imported lazily
 * (after the userId guard) so unit tests that never set a user don't pull in the
 * database module at load time.
 */
export function logEngineDecision(d: EngineDecision): void {
  if (!state.userId) return; // not user-scoped — nothing to attach the row to
  const userId = state.userId;
  void (async () => {
    try {
      const { logAutoTradeDecision } = await import("../lib/autoTrade/execute.js");
      await logAutoTradeDecision({
        userId,
        ticker: d.ticker,
        decision: d.decision,
        reasoning: d.reasoning,
        modelId: "deterministic",
        quantity: d.quantity ?? null,
        notional: d.notional ?? null,
        exitPrice: d.exitPrice ?? null,
        pnl: d.pnl ?? null,
        schwabOrderId: d.orderId ?? null,
        placed: d.placed ?? true,
        error: d.error ?? null,
      });
    } catch (err) {
      logger.warn({ err, ticker: d.ticker }, "[engine] logEngineDecision failed");
    }
  })();
}
