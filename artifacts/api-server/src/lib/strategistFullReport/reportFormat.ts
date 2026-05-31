const NA = "not available";

export function formatReportDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return NA;
  const clean = iso.split("T")[0].trim();
  const d = new Date(clean.length === 10 ? `${clean}T12:00:00` : clean);
  if (Number.isNaN(d.getTime())) return iso.trim();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NA;
  return `$${n.toFixed(2)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return NA;
  return `${n}%`;
}

/** maxLoss from strategist economics is per-share option premium at risk × 100 (cents field). */
export function fmtMaxLossLabel(maxLossField: number): string {
  if (!Number.isFinite(maxLossField) || maxLossField <= 0) return NA;
  const perShare = maxLossField / 100;
  const perContract = perShare * 100;
  if (perContract >= 100) {
    return `$${perContract.toFixed(0)}/contract`;
  }
  return `$${perContract.toFixed(2)}/contract ($${perShare.toFixed(2)}/sh)`;
}

export function fmtMaxProfitLabel(maxProfitField: number): string {
  if (maxProfitField >= 99999) return "Unlimited";
  return fmtMaxLossLabel(maxProfitField);
}

export function looksLikeMaxProfitScenario(text: string): boolean {
  return /\b(caps?\s+profit|max\s+profit|best[\s-]case|profit\s+if|above\s+\$?\d+.*profit|take\s+profit\s+at)\b/i.test(
    text,
  );
}

export function buildBearCaseProse(args: {
  direction: string;
  riskOfRuin?: string;
  bullInvalidation?: string;
  bearInvalidation?: string;
  reportBearCase?: string;
}): string {
  const custom = args.reportBearCase?.trim();
  if (custom) return custom;

  const parts: string[] = [];
  const ruin = args.riskOfRuin?.trim();
  if (ruin) parts.push(ruin);

  const dir = args.direction.toUpperCase();
  if (dir === "BULLISH") {
    const bear = args.bearInvalidation?.trim();
    if (bear && !looksLikeMaxProfitScenario(bear)) parts.push(bear);
  } else if (dir === "BEARISH") {
    const bull = args.bullInvalidation?.trim();
    if (bull && !looksLikeMaxProfitScenario(bull)) parts.push(bull);
  } else {
    for (const t of [args.bearInvalidation, args.bullInvalidation]) {
      const s = t?.trim();
      if (s && !looksLikeMaxProfitScenario(s)) parts.push(s);
    }
  }

  const joined = parts.join(" ").trim();
  return joined || "Gap or vol expansion through the structure invalidates the trade.";
}

export { NA };
