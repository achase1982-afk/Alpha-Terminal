/**
 * Active Trader order intent. Premiums are integer units of 1e-6 so
 * package math does not use binary floating point.
 *
 * Multiplier is supplied by the caller. Standard equity/SPX options use 100.
 * Adjusted deliverables are unsupported and must not be passed as 100.
 */

const SCALE = 1_000_000n;

export class Dec {
  private constructor(readonly units: bigint) {}

  static zero(): Dec {
    return new Dec(0n);
  }

  static fromUnits(units: bigint): Dec {
    return new Dec(units);
  }

  static parse(input: string): Dec | null {
    const s = input.trim();
    if (!/^[+-]?\d+(\.\d{1,6})?$/.test(s)) return null;
    const neg = s.startsWith("-");
    const body = s.replace(/^[+-]/, "");
    const [whole, frac = ""] = body.split(".");
    const units = BigInt(whole) * SCALE + BigInt((frac + "000000").slice(0, 6));
    return new Dec(neg ? -units : units);
  }

  static must(input: string): Dec {
    const v = Dec.parse(input);
    if (!v) throw new Error(`Invalid decimal: ${input}`);
    return v;
  }

  cmp(other: Dec): number {
    if (this.units < other.units) return -1;
    if (this.units > other.units) return 1;
    return 0;
  }

  eq(other: Dec): boolean {
    return this.units === other.units;
  }

  add(other: Dec): Dec {
    return new Dec(this.units + other.units);
  }

  sub(other: Dec): Dec {
    return new Dec(this.units - other.units);
  }

  neg(): Dec {
    return new Dec(-this.units);
  }

  mul(other: Dec): Dec {
    const neg = (this.units < 0n) !== (other.units < 0n);
    const a = this.units < 0n ? -this.units : this.units;
    const b = other.units < 0n ? -other.units : other.units;
    const prod = a * b;
    const q = prod / SCALE;
    const rem = prod % SCALE;
    const rounded = rem * 2n >= SCALE ? q + 1n : q;
    return new Dec(neg ? -rounded : rounded);
  }

  mulInt(n: number): Dec {
    if (!Number.isInteger(n)) throw new Error("mulInt requires an integer");
    return new Dec(this.units * BigInt(n));
  }

  isNeg(): boolean {
    return this.units < 0n;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isPos(): boolean {
    return this.units > 0n;
  }

  toFixed(dp: number): string {
    if (dp < 0 || dp > 6) throw new Error("dp out of range");
    const neg = this.units < 0n;
    const abs = neg ? -this.units : this.units;
    const scale = 10n ** BigInt(6 - dp);
    const half = scale / 2n;
    const q = (abs + half) / scale;
    const base = 10n ** BigInt(dp);
    const whole = q / base;
    const frac = (q % base).toString().padStart(dp, "0");
    const body = dp === 0 ? whole.toString() : `${whole.toString()}.${frac}`;
    return neg ? `-${body}` : body;
  }
}

export type PackageKind = "DEBIT" | "CREDIT" | "ZERO";
export type RoundDir = "up" | "down";

export interface PackageLeg {
  ratio: number;
  /** +1 buy-to-open, -1 sell-to-open. */
  side: 1 | -1;
  bid: string;
  ask: string;
  right: "CALL" | "PUT";
  strike: string;
  expiration: string;
}

export interface SignedQuotes {
  signedBid: Dec;
  signedAsk: Dec;
  signedMid: Dec;
  kind: PackageKind;
  /** Displayed bid/mid/ask magnitudes, ascending when the range does not cross zero. */
  displayBid: Dec;
  displayMid: Dec;
  displayAsk: Dec;
  crossesZero: boolean;
}

export function packageQuotes(legs: PackageLeg[]): SignedQuotes | { error: string } {
  if (legs.length === 0) return { error: "no legs" };
  let signedBid = Dec.zero();
  let signedAsk = Dec.zero();
  for (const leg of legs) {
    if (!Number.isInteger(leg.ratio) || leg.ratio < 1) return { error: "ratio" };
    const bid = Dec.parse(leg.bid);
    const ask = Dec.parse(leg.ask);
    if (!bid || !ask || bid.isNeg() || ask.isNeg() || bid.cmp(ask) > 0) return { error: "quote" };
    const bidTerm = leg.side === 1 ? bid : ask.neg();
    const askTerm = leg.side === 1 ? ask : bid.neg();
    signedBid = signedBid.add(bidTerm.mulInt(leg.ratio));
    signedAsk = signedAsk.add(askTerm.mulInt(leg.ratio));
  }
  const signedMid = signedBid.add(signedAsk).mul(Dec.must("0.5"));
  const crossesZero = signedBid.isNeg() && signedAsk.isPos();
  let kind: PackageKind = "ZERO";
  let displayBid = signedBid;
  let displayMid = signedMid;
  let displayAsk = signedAsk;
  if (!signedAsk.isNeg() && !signedAsk.isZero() && !signedBid.isNeg()) {
    kind = signedAsk.isZero() && signedBid.isZero() ? "ZERO" : "DEBIT";
  } else if (!signedBid.isPos() && !signedAsk.isPos()) {
    kind = signedBid.isZero() && signedAsk.isZero() ? "ZERO" : "CREDIT";
    displayBid = signedAsk.neg();
    displayMid = signedMid.neg();
    displayAsk = signedBid.neg();
  } else if (signedBid.isZero() && signedAsk.isZero()) {
    kind = "ZERO";
  } else {
    kind = signedMid.isNeg() ? "CREDIT" : signedMid.isPos() ? "DEBIT" : "ZERO";
  }
  return { signedBid, signedAsk, signedMid, kind, displayBid, displayMid, displayAsk, crossesZero };
}

export function cashAmount(packageQty: number, multiplier: string, premium: Dec): Dec {
  if (!Number.isInteger(packageQty) || packageQty < 1) throw new Error("qty");
  const m = Dec.parse(multiplier);
  if (!m || !m.isPos()) throw new Error("multiplier");
  return premium.mul(m).mulInt(packageQty);
}

export type PriceGrid = "spx-single" | "spx-complex" | "penny";

export function tickFor(price: Dec, grid: PriceGrid): Dec {
  if (grid === "penny") return Dec.must("0.01");
  if (grid === "spx-complex") return Dec.must("0.05");
  const three = Dec.must("3");
  return price.cmp(three) < 0 ? Dec.must("0.05") : Dec.must("0.10");
}

export function snapOnce(raw: Dec, grid: PriceGrid, dir: RoundDir): Dec {
  const tick = tickFor(raw, grid);
  if (raw.isNeg() || raw.isZero()) return raw;
  const q = raw.units / tick.units;
  const rem = raw.units % tick.units;
  if (rem === 0n) return Dec.fromUnits(raw.units);
  const next = dir === "up" ? (q + 1n) * tick.units : q * tick.units;
  return Dec.fromUnits(next);
}

export function stepSpxSingle(price: Dec, steps: number): Dec {
  let p = price;
  const n = Math.abs(steps);
  const up = steps >= 0;
  const three = Dec.must("3");
  for (let i = 0; i < n; i++) {
    if (up) {
      const tick = p.cmp(three) < 0 ? Dec.must("0.05") : Dec.must("0.10");
      p = p.add(tick);
    } else if (p.eq(three)) {
      p = Dec.must("2.95");
    } else {
      const tick = p.cmp(three) > 0 ? Dec.must("0.10") : Dec.must("0.05");
      p = p.sub(tick);
    }
  }
  return p;
}

export function percentageExitRaw(
  entry: Dec,
  kind: "DEBIT" | "CREDIT",
  role: "tp" | "sl",
  percent: Dec,
): { premium: Dec } | { error: string } {
  if (!percent.isPos() || percent.cmp(Dec.must("100")) > 0) return { error: "percent" };
  const p = percent.mul(Dec.must("0.01"));
  const one = Dec.must("1");
  if (kind === "DEBIT" && role === "tp") return { premium: entry.mul(one.add(p)) };
  if (kind === "DEBIT" && role === "sl") {
    if (p.cmp(one) >= 0) return { error: "debit stop would not be a loss" };
    return { premium: entry.mul(one.sub(p)) };
  }
  if (kind === "CREDIT" && role === "tp") {
    const premium = entry.mul(one.sub(p));
    if (!premium.isPos()) return { error: "credit target is not a positive premium" };
    return { premium };
  }
  return { premium: entry.mul(one.add(p)) };
}

export function roundExit(
  raw: Dec,
  kind: "DEBIT" | "CREDIT",
  role: "tp" | "sl",
  entry: Dec,
  grid: PriceGrid,
): { premium: Dec } | { error: string } {
  const dir: RoundDir =
    (kind === "DEBIT" && role === "tp") || (kind === "DEBIT" && role === "sl") || (kind === "CREDIT" && role === "sl")
      ? kind === "CREDIT" && role === "sl"
        ? "down"
        : "up"
      : "down";
  const snapped = snapOnce(raw, grid, dir);
  if (!snapped.isPos()) return { error: "non-positive exit" };
  if (snapped.eq(entry)) return { error: "rounded exit collapsed to entry" };
  if (role === "tp") {
    if (kind === "DEBIT" && snapped.cmp(entry) <= 0) return { error: "tp not above entry" };
    if (kind === "CREDIT" && snapped.cmp(entry) >= 0) return { error: "tp not below entry" };
  } else {
    if (kind === "DEBIT" && snapped.cmp(entry) >= 0) return { error: "stop not below entry" };
    if (kind === "CREDIT" && snapped.cmp(entry) <= 0) return { error: "stop not above entry" };
  }
  return { premium: snapped };
}

export function strategyName(legs: PackageLeg[]): string {
  if (legs.length === 1) {
    const leg = legs[0];
    const dir = leg.side === 1 ? "Long" : "Short";
    const right = leg.right === "CALL" ? "Call" : "Put";
    return `${dir} ${right}`;
  }
  if (
    legs.length === 2 &&
    legs[0].expiration === legs[1].expiration &&
    legs[0].right === legs[1].right &&
    legs[0].ratio === 1 &&
    legs[1].ratio === 1
  ) {
    const [a, b] = [...legs].sort((x, y) => Dec.must(x.strike).cmp(Dec.must(y.strike)));
    if (a.right === "PUT" && a.side === 1 && b.side === -1) return "Bull Put Spread";
    if (a.right === "PUT" && a.side === -1 && b.side === 1) return "Bear Put Spread";
    if (a.right === "CALL" && a.side === 1 && b.side === -1) return "Bull Call Spread";
    if (a.right === "CALL" && a.side === -1 && b.side === 1) return "Bear Call Spread";
  }
  return `Custom ${legs.length}-leg`;
}

export function brokerQuantity(packageQty: number, ratio: number): number {
  return packageQty * ratio;
}
