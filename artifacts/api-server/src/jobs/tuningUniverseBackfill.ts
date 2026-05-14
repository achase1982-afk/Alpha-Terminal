import "../loadEnv.js";
import { randomUUID } from "node:crypto";
import { TUNING_SYMBOLS } from "../data/tuningUniverse.js";
import {
  buildSymbolAudit,
  insertAuditRun,
  mergeSymbolOverallStatus,
  printSummaryTable,
  type AuditStatus,
  type SymbolAuditJson,
} from "./backfill/auditReport.js";
import { backfillCorporateEventsForTuningSymbol } from "./backfill/corporateEventsTuningBackfill.js";
import { backfillDividendsForSymbol } from "./backfill/dividendsBackfill.js";
import { computeEarningsReactionsForSymbol } from "./backfill/earningsReactionsCompute.js";
import { backfillEquityDailyForSymbol } from "./backfill/equityDailyBackfill.js";
import { backfillOptionsDailyForSymbol } from "./backfill/optionsDailyBackfill.js";

type DomainName =
  | "equity_daily"
  | "dividends"
  | "corporate_events"
  | "options_daily"
  | "earnings_reactions";

function fiveYearCutoffYmd(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 5);
  return d.toISOString().slice(0, 10);
}

function logEnterJob(universeSize: number, startedAt: string, runId: string): void {
  console.log(
    "ENTER tuning_backfill " + JSON.stringify({ universe_size: universeSize, started_at: startedAt, run_id: runId }),
  );
}

function logEnterSymbol(symbol: string, idx: number, total: number): void {
  console.log("ENTER tuning_backfill_symbol " + JSON.stringify({ symbol, idx, total }));
}

function logEnterDomain(symbol: string, domain: DomainName): void {
  console.log("ENTER tuning_backfill_domain " + JSON.stringify({ symbol, domain }));
}

function logExitDomain(
  symbol: string,
  domain: DomainName,
  metrics: { rows_inserted: number; rows_updated: number; rows_skipped: number; duration_ms: number; status: AuditStatus },
): void {
  console.log(
    "EXIT tuning_backfill_domain " +
      JSON.stringify({
        symbol,
        domain,
        rows_inserted: metrics.rows_inserted,
        rows_updated: metrics.rows_updated,
        rows_skipped: metrics.rows_skipped,
        duration_ms: metrics.duration_ms,
        status: metrics.status,
      }),
  );
}

function logExitSymbol(symbol: string, domains_completed: number, domains_failed: number, duration_ms: number): void {
  console.log(
    "EXIT tuning_backfill_symbol " + JSON.stringify({ symbol, domains_completed, domains_failed, duration_ms }),
  );
}

function logSummary(payload: {
  run_id: string;
  universe_size: number;
  overall_status: AuditStatus;
  failed_symbols: string[];
  warned_symbols: string[];
  duration_ms: number;
}): void {
  console.log("SUMMARY tuning_backfill " + JSON.stringify(payload));
}

function applyFailFlags(audit: SymbolAuditJson, flags: Set<DomainName>): SymbolAuditJson {
  const out = { ...audit };
  if (flags.has("equity_daily")) out.equity_daily = { ...out.equity_daily, status: "fail" };
  if (flags.has("dividends")) out.dividends = { ...out.dividends, status: "fail" };
  if (flags.has("corporate_events")) {
    out.corporate_events_earnings = { ...out.corporate_events_earnings, status: "fail" };
    out.corporate_events_splits = { ...out.corporate_events_splits, status: "fail" };
  }
  if (flags.has("options_daily")) out.options_daily = { ...out.options_daily, status: "fail" };
  if (flags.has("earnings_reactions")) out.earnings_reactions = { ...out.earnings_reactions, status: "fail" };
  return out;
}

export async function runTuningUniverseBackfill(opts?: {
  quiet?: boolean;
}): Promise<{
  runId: string;
  startedAt: string;
  completedAt: Date;
  overallStatus: AuditStatus;
  failedSymbols: string[];
  warnedSymbols: string[];
  durationMs: number;
  universeSize: number;
}> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const tJob0 = Date.now();
  const fiveCut = fiveYearCutoffYmd();

  logEnterJob(TUNING_SYMBOLS.length, startedAt, runId);

  const perSymbol: Record<string, SymbolAuditJson> = {};
  const summaryRows: Array<{ symbol: string; audit: SymbolAuditJson }> = [];
  const failedSymbols: string[] = [];
  const warnedSymbols: string[] = [];

  const total = TUNING_SYMBOLS.length;
  let idx = 0;
  for (const symbol of TUNING_SYMBOLS) {
    idx++;
    const tSym0 = Date.now();
    logEnterSymbol(symbol, idx, total);
    const failFlags = new Set<DomainName>();
    let domainsOk = 0;
    let domainsFailed = 0;

    const run = async (domain: DomainName, fn: () => Promise<{ rows?: number; rowsUpserted?: number }>): Promise<void> => {
      logEnterDomain(symbol, domain);
      const t0 = Date.now();
      try {
        const r = await fn();
        const n = r.rowsUpserted ?? r.rows ?? 0;
        logExitDomain(symbol, domain, {
          rows_inserted: 0,
          rows_updated: n,
          rows_skipped: 0,
          duration_ms: Date.now() - t0,
          status: "ok",
        });
        domainsOk++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(JSON.stringify({ symbol, domain, err: msg }));
        logExitDomain(symbol, domain, {
          rows_inserted: 0,
          rows_updated: 0,
          rows_skipped: 0,
          duration_ms: Date.now() - t0,
          status: "fail",
        });
        failFlags.add(domain);
        domainsFailed++;
      }
    };

    await run("equity_daily", () => backfillEquityDailyForSymbol(symbol));
    await run("dividends", () => backfillDividendsForSymbol(symbol));
    let fmpPremiumHistoricalUnavailable = false;
    await run("corporate_events", async () => {
      const r = await backfillCorporateEventsForTuningSymbol(symbol);
      fmpPremiumHistoricalUnavailable = r.fmpPremiumHistoricalUnavailable;
      return { rowsUpserted: r.calendarUpserts + r.surpriseUpserts + r.splitUpserts };
    });
    let optContracts = 0;
    await run("options_daily", async () => {
      const r = await backfillOptionsDailyForSymbol(symbol);
      optContracts = r.contractsProcessed;
      return { rowsUpserted: r.rowsUpserted };
    });
    await run("earnings_reactions", () => computeEarningsReactionsForSymbol(symbol));

    const rawAudit = await buildSymbolAudit({
      symbol,
      fiveYearCutoffYmd: fiveCut,
      optionsContractsProcessed: optContracts,
      fmpPremiumHistoricalUnavailable,
    });
    if (rawAudit.corporate_events_earnings.rows < 12) {
      console.warn(
        JSON.stringify({
          msg: "tuning_backfill coverage WARN",
          symbol,
          domain: "corporate_events_earnings",
          rows: rawAudit.corporate_events_earnings.rows,
          expected_min: 12,
        }),
      );
    }

    const audit = applyFailFlags(rawAudit, failFlags);
    perSymbol[symbol] = audit;
    summaryRows.push({ symbol, audit });

    const st = mergeSymbolOverallStatus(audit);
    if (st === "fail") failedSymbols.push(symbol);
    else if (st === "warn") warnedSymbols.push(symbol);

    logExitSymbol(symbol, domainsOk, domainsFailed, Date.now() - tSym0);
  }

  let overall: AuditStatus = "ok";
  if (failedSymbols.length > 0) overall = "fail";
  else if (warnedSymbols.length > 0) overall = "warn";

  const completedAt = new Date();
  await insertAuditRun({
    runId,
    startedAt: new Date(startedAt),
    completedAt,
    perSymbol,
    overallStatus: overall,
    universeSize: TUNING_SYMBOLS.length,
    notes: `tuning_universe_backfill`,
  });

  if (!opts?.quiet) {
    printSummaryTable(summaryRows);
  }
  logSummary({
    run_id: runId,
    universe_size: TUNING_SYMBOLS.length,
    overall_status: overall,
    failed_symbols: failedSymbols,
    warned_symbols: warnedSymbols,
    duration_ms: Date.now() - tJob0,
  });

  return {
    runId,
    startedAt,
    completedAt,
    overallStatus: overall,
    failedSymbols,
    warnedSymbols,
    durationMs: Date.now() - tJob0,
    universeSize: TUNING_SYMBOLS.length,
  };
}

async function main(): Promise<void> {
  const r = await runTuningUniverseBackfill();
  if (r.overallStatus === "fail") {
    process.exitCode = 1;
  }
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
