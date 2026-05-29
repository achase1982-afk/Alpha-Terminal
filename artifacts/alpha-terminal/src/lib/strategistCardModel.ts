import type { StrategistV2Result } from "@/components/StrategistV2Card";
import type { DeskResult, DeskResultClassic } from "@/lib/strategistDeskResult";

export type StrategistCardLeg = {
  side: "BUY" | "SELL";
  expiry: string;
  strikeType: string;
  deltaLabel: string;
  price: string;
};

export type StrategistTradeCardModel = {
  ticker: string;
  generatedAt?: string | number | null;
  underlyingAtSignal: number | null;
  confidence: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  strategyName: string;
  structureDescriptor: string;
  legs: StrategistCardLeg[];
  isCredit: boolean;
  /** Multi-expiry debit (calendar / diagonal): row 1 label uses "max risk". */
  debitRowUsesMaxRisk: boolean;
  netEntry: number;
  maxProfit: number;
  maxLoss: number;
  maxProfitDisplay?: string;
  maxLossDisplay?: string;
  maxProfitShowEst: boolean;
  riskRewardDisplay: string;
  entryStockBand: string | null;
  fillBand: string | null;
  exitPlan: {
    profitDisplay: string;
    stopDisplay: string;
    timeStop: string;
  } | null;
  whyBullets: string[];
  whatKillsBullets: string[];
  reportDrawer?: {
    company: string;
    thesis: string;
    exitDetail: string;
    levelsLiquidity: string;
    edgeRegime: string;
  };
  plainTextSource: StrategistV2Result | null;
  deskPlainText?: string;
};

const TOKENS = {
  green: "#46d486",
  red: "#ff7a7a",
  amber: "#f5a524",
  yellow: "#ffd23f",
} as const;

export function confidenceColor(score: number): string {
  if (score >= 70) return TOKENS.green;
  if (score >= 65) return TOKENS.yellow;
  return TOKENS.red;
}

export function directionStyle(direction: string): { color: string; glyph: string } {
  const d = direction.toUpperCase();
  if (d === "BULLISH") return { color: TOKENS.green, glyph: "↗" };
  if (d === "BEARISH") return { color: TOKENS.red, glyph: "↘" };
  return { color: TOKENS.amber, glyph: "→" };
}

export function formatGenerated(d: string | number | undefined | null): string {
  if (d == null) return "";
  const dt = typeof d === "number" ? new Date(d) : new Date(d);
  if (isNaN(dt.getTime())) return "";
  const date = `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(-2)}`;
  const time = dt
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s/g, " ");
  return `${date} · ${time}`;
}

function formatLegExpiry(raw: string): string {
  if (!raw) return raw;
  const clean = raw.split(":")[0].trim();
  const d = new Date(clean.length === 10 ? `${clean}T12:00:00` : clean);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dteForExpiry(iso: string): number {
  const d = new Date(iso.split(":")[0].trim() + "T12:00:00");
  return Math.max(0, Math.round((d.getTime() - Date.now()) / 86400000));
}

function formatMoneyRange(lo: number | null | undefined, hi: number | null | undefined): string | null {
  if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return `$${lo.toFixed(2)}–$${hi.toFixed(2)}`;
}

function formatFillRange(min: number | undefined, max: number | undefined): string | null {
  if (min == null || max == null) return null;
  return `$${Math.abs(min).toFixed(2)}–$${Math.abs(max).toFixed(2)}`;
}

function strategyLabel(strategyType: string): string {
  const labels: Record<string, string> = {
    bull_put_spread: "Bull Put Spread",
    bear_call_spread: "Bear Call Spread",
    bull_call_spread: "Bull Call Spread",
    bear_put_spread: "Bear Put Spread",
    iron_condor: "Iron Condor",
    iron_butterfly: "Iron Butterfly",
    calendar: "Calendar",
    diagonal: "Diagonal",
    double_diagonal: "Double Diagonal",
    long_call: "Long Call",
    long_put: "Long Put",
  };
  return (
    labels[strategyType] ??
    strategyType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function buildStructureDescriptor(rec: NonNullable<StrategistV2Result["recommendation"]>): string {
  const strikes = rec.legs.map((l) => l.strike).sort((a, b) => a - b);
  const width = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : null;
  const exps = [...new Set(rec.legs.map((l) => l.expiration.split(":")[0].trim()))];
  const dtes = exps.map((e) => dteForExpiry(e));

  if (rec.legs.length === 1) {
    return `single · ${rec.dte} DTE`;
  }
  if (exps.length > 1) {
    const st = strategyLabel(rec.strategyType).toLowerCase();
    if (st.includes("calendar") && width === 0) {
      return `same strike · ${dtes.join("/")} DTE`;
    }
    if (st.includes("diagonal")) {
      return `${dtes.join("/")} DTE`;
    }
    return `${dtes.join("/")} DTE`;
  }
  if (rec.strategyType.includes("iron")) {
    return `$${width ?? 5} wide · ${rec.dte} DTE`;
  }
  if (width != null && width > 0) {
    return `$${width} wide · ${rec.dte} DTE`;
  }
  return `${rec.dte} DTE`;
}

export function formatRiskRewardDisplay(raw: string | undefined, ratio: number): string {
  if (raw) {
    const lower = raw.toLowerCase();
    if (lower.includes("open")) return "OPEN-ENDED";
    if (lower.includes("var")) return "VARIES";
    return raw.includes(":") ? raw.toUpperCase() : `${raw} : 1`.toUpperCase();
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return "VARIES";
  return `${ratio.toFixed(2)} : 1`;
}

function formatExitProfitDisplay(args: {
  isCredit: boolean;
  isMultiExp: boolean;
  maxProfit: number;
  profitTargetPct?: number;
  profitTarget?: number;
}): string {
  const { isMultiExp, maxProfit, profitTargetPct, profitTarget } = args;
  if (maxProfit >= 99999) {
    const pct = profitTargetPct ?? 100;
    const px = profitTarget && profitTarget > 0 ? ` $${profitTarget.toFixed(2)}` : "";
    return `+${pct}%${px}`;
  }
  if (isMultiExp && maxProfit > 0) {
    const pct = profitTargetPct ?? 50;
    return `~${pct}% est.`;
  }
  const pct = profitTargetPct ?? 62;
  const px = profitTarget && profitTarget > 0 ? ` $${profitTarget.toFixed(2)}` : "";
  return `${pct}%${px}`;
}

function formatExitStopDisplay(stopPct?: number, stopPrice?: number): string {
  const pct = stopPct ?? 30;
  const px = stopPrice && stopPrice > 0 ? ` $${stopPrice.toFixed(2)}` : "";
  return `−${pct}%${px}`;
}

export function modelFromV2Result(
  result: StrategistV2Result,
  generatedAt?: string | number | null,
): StrategistTradeCardModel | null {
  const rec = result.recommendation;
  if (!rec) return null;

  const isCredit = rec.credit != null && rec.credit > 0;
  const netEntry = (isCredit ? rec.credit : rec.debit) ?? 0;
  const dir = (rec.direction?.toUpperCase() || "NEUTRAL") as StrategistTradeCardModel["direction"];
  const exps = new Set(rec.legs.map((l) => l.expiration.split(":")[0].trim()));
  const isMultiExp = exps.size > 1;

  const legs: StrategistCardLeg[] = rec.legs.map((leg) => ({
    side: leg.side === "buy" ? "BUY" : "SELL",
    expiry: formatLegExpiry(leg.expiration),
    strikeType: `$${leg.strike} ${leg.type.toUpperCase()}`,
    deltaLabel: `${Math.round(Math.abs(leg.delta) * 100)} delta`,
    price: `$${leg.mid.toFixed(2)}`,
  }));

  const et = rec.exitTargets;
  const exitPlan =
    et && (et.profitTarget > 0 || et.stopLoss > 0 || et.timeStop)
      ? {
          profitDisplay: formatExitProfitDisplay({
            isCredit,
            isMultiExp,
            maxProfit: rec.maxProfit,
            profitTargetPct: et.profitTargetPct,
            profitTarget: et.profitTarget,
          }),
          stopDisplay: formatExitStopDisplay(et.stopLossPct, et.stopLoss),
          timeStop: et.timeStop ? formatLegExpiry(et.timeStop) : "",
        }
      : null;

  const maxProfitShowEst =
    isMultiExp && rec.maxProfit > 0 && rec.maxProfit < 99999 && !rec.maxProfitDisplay;

  return {
    ticker: result.ticker,
    generatedAt,
    underlyingAtSignal: rec.underlyingAtSignal ?? null,
    confidence: rec.confidence ?? 0,
    direction: dir === "BULLISH" || dir === "BEARISH" ? dir : "NEUTRAL",
    strategyName: strategyLabel(rec.strategyType),
    structureDescriptor: buildStructureDescriptor(rec),
    legs,
    isCredit,
    debitRowUsesMaxRisk: !isCredit && isMultiExp,
    netEntry,
    maxProfit: rec.maxProfit,
    maxLoss: rec.maxLoss,
    maxProfitDisplay: rec.maxProfitDisplay,
    maxLossDisplay: rec.maxLossDisplay,
    maxProfitShowEst,
    riskRewardDisplay: formatRiskRewardDisplay(rec.riskRewardDisplay, rec.riskReward),
    entryStockBand: formatMoneyRange(rec.entryStockMin, rec.entryStockMax),
    fillBand: formatFillRange(rec.entryRangeMin, rec.entryRangeMax),
    exitPlan,
    whyBullets: rec.whyBullets ?? [],
    whatKillsBullets: rec.whatKillsBullets ?? [],
    reportDrawer: rec.reportDrawer,
    plainTextSource: result,
  };
}

export function modelFromDeskResult(
  deskResult: DeskResult,
  ticker: string,
  generatedAt?: string | number | null,
): StrategistTradeCardModel | null {
  if (deskResult.mode === "conviction_desk") return null;
  const dr = deskResult as DeskResultClassic;
  if (dr.pm.decision !== "trade" || !dr.pm.structure) return null;

  const s = dr.pm.structure;
  const isCredit = s.credit_or_debit < 0;
  const netEntry = Math.abs(s.credit_or_debit);
  const expirations = [...new Set(s.legs.map((l) => l.expiration))];
  const isMultiExp = expirations.length > 1;
  const dtes = expirations.map((e) => dteForExpiry(e));
  const strikes = s.legs.map((l) => l.strike);
  const sameStrike = strikes.length > 1 && strikes.every((k) => k === strikes[0]);

  let structureDescriptor = `$${Math.max(...strikes) - Math.min(...strikes)} wide · ${dtes[0] ?? 20} DTE`;
  if (s.legs.length === 1) structureDescriptor = `single · ${dtes[0] ?? 20} DTE`;
  else if (isMultiExp && sameStrike) structureDescriptor = `same strike · ${dtes.join("/")} DTE`;
  else if (isMultiExp) structureDescriptor = `${dtes.join("/")} DTE`;

  const legs: StrategistCardLeg[] = s.legs.map((leg) => {
    const isBuy = leg.action.toLowerCase().startsWith("buy");
    return {
      side: isBuy ? "BUY" : "SELL",
      expiry: formatLegExpiry(leg.expiration),
      strikeType: `$${leg.strike} ${leg.type.toUpperCase().includes("CALL") ? "CALL" : "PUT"}`,
      deltaLabel: "50 delta",
      price: "—",
    };
  });

  const ep = dr.pm.exit_plan;
  const exitPlan = {
    profitDisplay: isMultiExp ? "~50% est." : `62% $${ep.profit_target.toFixed(2)}`,
    stopDisplay: `−30% $${ep.stop_loss.toFixed(2)}`,
    timeStop: ep.time_stop ? formatLegExpiry(ep.time_stop) : "",
  };

  const whyBullets = dr.pm.thesis ? proseToBullets(dr.pm.thesis, 6) : [];
  const whatKillsBullets = dr.pm.biggest_risk ? proseToBullets(dr.pm.biggest_risk, 6) : [];

  return {
    ticker,
    generatedAt,
    underlyingAtSignal: null,
    confidence: 56,
    direction: "NEUTRAL",
    strategyName: s.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    structureDescriptor,
    legs,
    isCredit,
    debitRowUsesMaxRisk: !isCredit && isMultiExp,
    netEntry,
    maxProfit: (() => {
      const w = Math.max(...strikes) - Math.min(...strikes);
      return isCredit ? netEntry * 100 : Math.max(0, (w - netEntry) * 100);
    })(),
    maxLoss: (() => {
      const w = Math.max(...strikes) - Math.min(...strikes);
      return isCredit ? Math.max(0, (w - netEntry) * 100) : netEntry * 100;
    })(),
    maxProfitShowEst: isMultiExp && !isCredit,
    riskRewardDisplay: isMultiExp ? "VARIES" : "2.85 : 1",
    entryStockBand: null,
    fillBand: null,
    exitPlan,
    whyBullets,
    whatKillsBullets,
    plainTextSource: null,
    deskPlainText: undefined,
  };
}

function proseToBullets(text: string, max: number): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    .slice(0, max);
}

export { TOKENS };
