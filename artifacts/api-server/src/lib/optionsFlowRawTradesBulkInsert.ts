/**
 * Rows per statement for multi-row INSERT into options_flow_raw_trades.
 * PostgreSQL rejects queries whose bound-parameter count exceeds 65535.
 * Drizzle's batched insert can emit multiple bind parameters per logical
 * column; ~400 rows stays safely under the limit even with heavy expansion.
 */
export const OPTIONS_FLOW_RAW_TRADES_INSERT_MAX_ROWS = 400;
