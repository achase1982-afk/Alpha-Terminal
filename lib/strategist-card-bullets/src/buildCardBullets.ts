import type { TradeDirection } from "./tradeDirection.js";
import {
  CARD_BULLET_MAX_COUNT,
  enforceCardBullets,
  proseToCardBullets,
  tightenCardBullet,
} from "./cardBulletCore.js";

export type CardBulletBuildInput = {
  ticker: string;
  direction: TradeDirection;
  spot: number | null;
  ivr: number | null;
  ivrSource?: string | null;
  pcRatio: number | null;
  shortStrike: number | null;
  shortType?: "call" | "put" | null;
  breakeven: number | null;
  dte: number | null;
  catalystDate: string | null;
  catalystType: string | null;
  catalystAlignment?: string | null;
  dailyChangePct: number | null;
  idioPct: number | null;
  relativeVolume: number | null;
  earningsDate: string | null;
  earningsInsideExpiry?: boolean;
  thesis: string;
  bullInvalidation: string;
  bearInvalidation: string;
  riskOfRuin: string;
  warnings: string | null;
};

function formatCatalystDate(iso: string | null): string | null {
  if (!iso?.trim()) return null;
  const clean = iso.split("T")[0].trim();
  const d = new Date(clean.length === 10 ? `${clean}T12:00:00` : clean);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMoney(n: number): string {
  if (n >= 1000) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2).replace(/\.?0+$/, "")}`;
}

function pushUnique(out: string[], candidate: string | null): void {
  if (!candidate || out.length >= CARD_BULLET_MAX_COUNT) return;
  const key = candidate.toLowerCase();
  if (out.some((b) => b.toLowerCase() === key)) return;
  out.push(candidate);
}

function buildDataWhy(input: CardBulletBuildInput): string[] {
  const out: string[] = [];
  const sym = input.ticker.toUpperCase();
  const catDate = formatCatalystDate(input.catalystDate);
  const earnDate = formatCatalystDate(input.earningsDate);
  const bullish = input.direction === "BULLISH";
  const bearish = input.direction === "BEARISH";

  if (input.ivr != null && Number.isFinite(input.ivr)) {
    const ivr = Math.round(input.ivr);
    if (bullish && ivr >= 45) {
      pushUnique(out, tightenCardBullet(`${sym} IVR ${ivr} — sell rich premium`));
    } else if (bearish && ivr >= 45) {
      pushUnique(out, tightenCardBullet(`${sym} IVR ${ivr} — sell call premium`));
    } else if (ivr <= 35) {
      pushUnique(out, tightenCardBullet(`${sym} IVR ${ivr} — cheap long vol`));
    }
  }

  if (input.pcRatio != null && Number.isFinite(input.pcRatio)) {
    const pc = input.pcRatio.toFixed(2).replace(/\.?0+$/, "");
    if (bullish && input.pcRatio < 0.85) {
      pushUnique(out, tightenCardBullet(`P/C vol ${pc} — call flow leads`));
    } else if (bearish && input.pcRatio > 1.15) {
      pushUnique(out, tightenCardBullet(`P/C vol ${pc} — put flow leads`));
    }
  }

  if (catDate && input.catalystType && input.catalystType !== "NONE") {
    const tag = input.catalystType.replace(/_/g, " ").toLowerCase();
    if (input.catalystAlignment === "ALIGNED") {
      pushUnique(out, tightenCardBullet(`${tag} ${catDate} aligns with trade`));
    } else if (input.catalystAlignment !== "CONTRADICTS") {
      pushUnique(out, tightenCardBullet(`${tag} ${catDate} in window`));
    }
  }

  if (input.dailyChangePct != null && Number.isFinite(input.dailyChangePct)) {
    const pct = `${input.dailyChangePct >= 0 ? "+" : ""}${input.dailyChangePct.toFixed(1)}%`;
    if (bullish && input.dailyChangePct > 0.5) {
      pushUnique(out, tightenCardBullet(`${sym} ${pct} today — tape firm`));
    } else if (bearish && input.dailyChangePct < -0.5) {
      pushUnique(out, tightenCardBullet(`${sym} ${pct} today — tape weak`));
    }
  }

  if (input.idioPct != null && input.idioPct >= 55) {
    pushUnique(out, tightenCardBullet(`Idio ${input.idioPct}% — name drives move`));
  }

  if (input.relativeVolume != null && input.relativeVolume >= 1.25) {
    const rv = input.relativeVolume.toFixed(1).replace(/\.0$/, "");
    pushUnique(out, tightenCardBullet(`Rel vol ${rv}x — active tape`));
  }

  if (earnDate && bullish && !input.earningsInsideExpiry) {
    pushUnique(out, tightenCardBullet(`Earnings ${earnDate} — drift setup`));
  }

  return out;
}

function buildDataKills(input: CardBulletBuildInput): string[] {
  const out: string[] = [];
  const sym = input.ticker.toUpperCase();
  const catDate = formatCatalystDate(input.catalystDate);
  const earnDate = formatCatalystDate(input.earningsDate);
  const bullish = input.direction === "BULLISH";
  const bearish = input.direction === "BEARISH";

  if (input.shortStrike != null && Number.isFinite(input.shortStrike)) {
    const strike = formatMoney(input.shortStrike);
    if (input.shortType === "put" && bullish) {
      pushUnique(out, tightenCardBullet(`Close below ${strike} short put`));
    } else if (input.shortType === "call" && bearish) {
      pushUnique(out, tightenCardBullet(`Rally above ${strike} short call`));
    }
  }

  if (input.breakeven != null && Number.isFinite(input.breakeven)) {
    const be = formatMoney(input.breakeven);
    if (bullish) {
      pushUnique(out, tightenCardBullet(`Break under ${be} breakeven`));
    } else if (bearish) {
      pushUnique(out, tightenCardBullet(`Break above ${be} breakeven`));
    }
  }

  if (input.catalystAlignment === "CONTRADICTS" && catDate) {
    pushUnique(out, tightenCardBullet(`Catalyst ${catDate} flips thesis`));
  }

  if (input.earningsInsideExpiry && earnDate) {
    pushUnique(out, tightenCardBullet(`Earnings ${earnDate} inside DTE`));
  }

  if (input.ivr != null && input.ivr >= 60 && bullish) {
    pushUnique(out, tightenCardBullet(`IV crush after vol mean reverts`));
  }

  if (input.dte != null && input.dte <= 14) {
    pushUnique(out, tightenCardBullet(`${input.dte} DTE — gamma risk rises`));
  }

  pushUnique(out, tightenCardBullet(`${sym} macro gap through structure`));

  return out;
}

/** WHY = trade tailwinds; KILLS = invalidation triggers. Data-first, prose backfill. */
export function buildCardBriefBullets(
  input: CardBulletBuildInput,
): { whyItWorks: string[]; whatKillsIt: string[] } {
  const whyData = buildDataWhy(input);
  const killData = buildDataKills(input);

  const whyProse =
    input.direction === "BEARISH"
      ? proseToCardBullets(input.bearInvalidation || input.thesis, 3)
      : proseToCardBullets(input.thesis, 4);
  const killProse =
    input.direction === "BULLISH"
      ? [
          ...proseToCardBullets(input.bullInvalidation, 3),
          ...proseToCardBullets(input.riskOfRuin, 2),
          ...proseToCardBullets(input.warnings ?? "", 2),
        ]
      : input.direction === "BEARISH"
        ? [
            ...proseToCardBullets(input.bearInvalidation, 3),
            ...proseToCardBullets(input.riskOfRuin, 2),
            ...proseToCardBullets(input.warnings ?? "", 2),
          ]
        : [
            ...proseToCardBullets(input.bullInvalidation, 2),
            ...proseToCardBullets(input.bearInvalidation, 2),
            ...proseToCardBullets(input.riskOfRuin, 1),
          ];

  let whyItWorks = enforceCardBullets([...whyData, ...whyProse]);
  let whatKillsIt = enforceCardBullets([...killData, ...killProse]);

  if (whyItWorks.length === 0) {
    const fb = tightenCardBullet(input.thesis) ?? tightenCardBullet(`${input.ticker} setup aligns`);
    if (fb) whyItWorks = enforceCardBullets([fb]);
  }
  if (whatKillsIt.length === 0) {
    const src =
      input.direction === "BULLISH"
        ? input.bullInvalidation
        : input.direction === "BEARISH"
          ? input.bearInvalidation
          : input.riskOfRuin;
    const fb = tightenCardBullet(src) ?? tightenCardBullet("Structure breaks — exit");
    if (fb) whatKillsIt = enforceCardBullets([fb]);
  }

  return {
    whyItWorks: whyItWorks.slice(0, CARD_BULLET_MAX_COUNT),
    whatKillsIt: whatKillsIt.slice(0, CARD_BULLET_MAX_COUNT),
  };
}
