import { isNotNull } from "@workspace/db";
import { optionsFlowRawTradesTable } from "@workspace/db";

/**
 * Rows per statement for multi-row INSERT into options_flow_raw_trades.
 * PostgreSQL rejects queries whose bound-parameter count exceeds 65535.
 * Drizzle's batched insert can emit multiple bind parameters per logical
 * column; ~400 rows stays safely under the limit even with heavy expansion.
 */
export const OPTIONS_FLOW_RAW_TRADES_INSERT_MAX_ROWS = 400;

/**
 * ON CONFLICT target for partial unique index `options_flow_raw_trades_source_dedup_idx`
 * (underlying_symbol, date, source_trade_id) WHERE source_trade_id IS NOT NULL.
 * Without `where`, Postgres returns 42P10.
 */
export const OPTIONS_FLOW_RAW_TRADES_ON_CONFLICT_SOURCE_DEDUPE = {
  target: [
    optionsFlowRawTradesTable.underlyingSymbol,
    optionsFlowRawTradesTable.date,
    optionsFlowRawTradesTable.sourceTradeId,
  ],
  where: isNotNull(optionsFlowRawTradesTable.sourceTradeId),
};
