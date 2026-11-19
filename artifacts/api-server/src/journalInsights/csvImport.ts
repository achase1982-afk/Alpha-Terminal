import { rebuildAccount, upsertActivities } from "./store.js";
import { parseOptionSymbol } from "./normalize.js";
import { upsertBook } from "./quotes.js";
import type { NormalizedActivity, NormalizedLeg } from "./types.js";

export interface CsvImportResult {
  importedTrades: number;
  skippedDuplicates: number;
  accountId: string;
}

function cells(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current.trim());
  return out;
}

function headerIndex(header: string[], names: string[]): number {
  const lowered = header.map((cell) => cell.toLowerCase());
  return lowered.findIndex((cell) => names.some((name) => cell === name || cell.includes(name)));
}

function parseWhen(value: string): string | null {
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  let hour = Number(match[4] ?? "12");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  const suffix = (match[7] ?? "").toUpperCase();
  if (suffix === "PM" && hour < 12) hour += 12;
  if (suffix === "AM" && hour === 12) hour = 0;
  const iso = new Date(Date.UTC(year, month - 1, day, hour + 5, minute, second)).toISOString();
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

function numberFrom(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function legFor(symbol: string, side: "buy" | "sell", qty: number, price: number, fees: number): NormalizedLeg {
  const option = parseOptionSymbol(symbol);
  if (option) {
    return {
      instrumentKey: option.instrumentKey,
      assetClass: "option",
      underlying: option.underlying,
      putCall: option.putCall,
      strike: option.strike,
      expiration: option.expiration,
      quantityDelta: side === "buy" ? qty : -qty,
      price,
      multiplier: 100,
      fees,
      effect: null,
    };
  }
  const key = symbol.toUpperCase();
  return {
    instrumentKey: key,
    assetClass: "equity",
    underlying: key,
    putCall: null,
    strike: null,
    expiration: null,
    quantityDelta: side === "buy" ? qty : -qty,
    price,
    multiplier: 1,
    fees,
    effect: null,
  };
}

export function parseCsvFills(csv: string, accountRef: string, format: string): NormalizedActivity[] {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = cells(lines[0] ?? "");
  const timeAt = headerIndex(header, ["filled time", "datetime", "date", "time"]);
  const symbolAt = headerIndex(header, ["symbol"]);
  const sideAt = headerIndex(header, ["side", "action"]);
  const qtyAt = headerIndex(header, ["filled qty", "quantity", "qty", "filled"]);
  const priceAt = headerIndex(header, ["avg price", "price"]);
  const feeAt = headerIndex(header, ["fees & comm", "fees", "commission", "fee"]);
  const idAt = headerIndex(header, ["execution id", "exec id", "order id", "id"]);
  if (timeAt < 0 || symbolAt < 0 || sideAt < 0 || qtyAt < 0 || priceAt < 0) return [];
  const activities: NormalizedActivity[] = [];
  lines.slice(1).forEach((line, index) => {
    const row = cells(line);
    const when = parseWhen(row[timeAt] ?? "");
    const symbol = (row[symbolAt] ?? "").toUpperCase();
    const action = (row[sideAt] ?? "").toLowerCase();
    const side: "buy" | "sell" | null = action.includes("buy") ? "buy" : action.includes("sell") ? "sell" : null;
    const qty = Math.abs(numberFrom(row[qtyAt]));
    const price = Math.abs(numberFrom(row[priceAt]));
    if (!when || !symbol || !side || qty <= 0) return;
    const fees = Math.abs(numberFrom(feeAt >= 0 ? row[feeAt] : ""));
    const rawId = (idAt >= 0 ? row[idAt] : "") || `${format}:${index}:${when}:${symbol}`;
    const leg = legFor(symbol, side, qty, price, fees);
    const cash = side === "sell" ? qty * price * leg.multiplier : -(qty * price * leg.multiplier);
    activities.push({
      id: `${accountRef}:csv:${rawId}`,
      accountRef,
      occurredAt: when,
      kind: "trade",
      netAmount: cash - fees,
      fees,
      orderRef: `${accountRef}:csv:${rawId}`,
      description: "",
      legs: [leg],
    });
  });
  return activities;
}

export async function importCsvFills(input: {
  csv: string;
  format: string;
  accountId: string;
  existingIds: Set<string>;
}): Promise<CsvImportResult> {
  const accountId = input.accountId === "paper_sandbox" ? "paper_sandbox" : input.accountId;
  const paper = accountId === "paper_sandbox";
  await upsertBook({ accountRef: accountId, label: paper ? "Paper Sandbox" : "Imported account", paper });
  const parsed = parseCsvFills(input.csv, accountId, input.format);
  const fresh = parsed.filter((activity) => !input.existingIds.has(activity.id));
  if (fresh.length > 0) {
    await upsertActivities(fresh.map((activity) => ({ activity, payload: { source: "csv" } })));
    await rebuildAccount(accountId);
  }
  return {
    importedTrades: fresh.length,
    skippedDuplicates: parsed.length - fresh.length,
    accountId,
  };
}
