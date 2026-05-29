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
  netEntry: number;
  maxProfit: number;
  maxLoss: number;
  maxProfitDisplay?: string;
  maxLossDisplay?: string;
  riskRewardDisplay: string;
  entryStockBand: string | null;
  fillBand: string | null;
  exitPlan: {
    profitPct: number;
    profitPrice: string;
    stopPct: number;
    stopPrice: string;
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

function formatGenerated(d: string | number | undefined | null): string {
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
  const exps = [...new Set(rec.legs.map((l) => l.expiration))];
  const parts: string[] = [];
  if (exps.length > 1) {
    const dtes = exps.map((e) => {
      const d = new Date(e.split(":")[0] + "T12:00:00");
      const days = Math.max(0, Math.round((d.getTime() - Date.now()) / 86400000));
      return days;
    });
    parts.push(`Calendar · ${dtes.join("/")} DTE`);
  } else if (rec.strategyType.includes("iron")) {
    parts.push(`Iron Condor · $${width ?? "?"} wide · ${rec.dte} DTE`);
  } else if (width != null && width > 0) {
    parts.push(`$${width} wide · ${rec.dte} DTE`);
  } else {
    parts.push(`${rec.dte} DTE`);
  }
  return parts.join(" · ");
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

  const legs: StrategistCardLeg[] = rec.legs.map((leg) => ({
    side: leg.side === "buy" ? "BUY" : "SELL",
    expiry: formatLegExpiry(leg.expiration),
    strikeType: `$${leg.strike} ${leg.type.toUpperCase()}`,
    deltaLabel: `${Math.round(Math.abs(leg.delta) * 100)} delta`,
    price: `$${leg.mid.toFixed(2)}`,
  }));

  const et = rec.exitTargets;
  const exitPlan =
    et &&
    (et.profitTarget > 0 || et.stopLoss > 0 || et.timeStop)
      ? {
          profitPct: et.profitTargetPct ?? 62,
          profitPrice: et.profitTarget > 0 ? `$${et.profitTarget.toFixed(2)}` : "",
          stopPct: et.stopLossPct ?? 30,
          stopPrice: et.stopLoss > 0 ? `$${et.stopLoss.toFixed(2)}` : "",
          timeStop: et.timeStop ? formatLegExpiry(et.timeStop) : "",
        }
      : null;

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
    netEntry,
    maxProfit: rec.maxProfit,
    maxLoss: rec.maxLoss,
    maxProfitDisplay: rec.maxProfitDisplay,
    maxLossDisplay: rec.maxLossDisplay,
    riskRewardDisplay: rec.riskRewardDisplay ?? (rec.riskReward > 0 ? `${rec.riskReward.toFixed(2)} : 1` : "varies"),
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
  const strikes = s.legs.map((l) => l.strike).sort((a, b) => a - b);
  const width = strikes.length >= 2 ? strikes[strikes.length - 1] - strikes[0] : null;
  const expirations = [...new Set(s.legs.map((l) => l.expiration))];
  let structureDescriptor = "";
  if (expirations.length > 1) {
    const dtes = expirations.map((e) => {
      const d = new Date(e.split(":")[0] + "T12:00:00");
      return Math.max(0, Math.round((d.getTime() - Date.now()) / 86400000));
    });
    structureDescriptor = `Calendar · ${dtes.join("/")} DTE`;
  } else if (width != null) {
    structureDescriptor = `$${width} wide · ${structureDescriptor || ""}${s.type.replace(/_/g, " ")}`;
  }

  const legs: StrategistCardLeg[] = s.legs.map((leg) => {
    const isBuy = leg.action.toLowerCase().startsWith("buy");
    return {
      side: isBuy ? "BUY" : "SELL",
      expiry: formatLegExpiry(leg.expiration),
      strikeType: `$${leg.strike} ${leg.type.toUpperCase().includes("CALL") ? "CALL" : "PUT"}`,
      deltaLabel: "— delta",
      price: "—",
    };
  });

  const ep = dr.pm.exit_plan;
  const exitPlan = {
    profitPct: 62,
    profitPrice: ep.profit_target > 0 ? `$${ep.profit_target.toFixed(2)}` : "",
    stopPct: 30,
    stopPrice: ep.stop_loss > 0 ? `$${ep.stop_loss.toFixed(2)}` : "",
    timeStop: ep.time_stop ? formatLegExpiry(ep.time_stop) : "",
  };

  const whyBullets = dr.pm.thesis ? [dr.pm.thesis.slice(0, 200)] : [];
  const whatKillsBullets = dr.pm.biggest_risk ? [dr.pm.biggest_risk.slice(0, 200)] : [];

  return {
    ticker,
    generatedAt,
    underlyingAtSignal: null,
    confidence: 56,
    direction: "NEUTRAL",
    strategyName: s.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    structureDescriptor: structureDescriptor || s.type.replace(/_/g, " "),
    legs,
    isCredit,
    netEntry,
    maxProfit: isCredit ? netEntry * 100 : Math.max(0, (width ?? 5) * 100 - netEntry * 100),
    maxLoss: isCredit ? Math.max(0, ((width ?? 5) - netEntry) * 100) : netEntry * 100,
    riskRewardDisplay: "varies",
    entryStockBand: null,
    fillBand: null,
    exitPlan,
    whyBullets,
    whatKillsBullets,
    plainTextSource: null,
    deskPlainText: undefined,
  };
}

export { formatGenerated, TOKENS };
