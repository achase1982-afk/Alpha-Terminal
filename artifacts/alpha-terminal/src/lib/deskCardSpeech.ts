/**
 * Builds Web Speech–friendly section scripts for the Strategist Desk card.
 * Presentation-only: natural phrasing, no raw JSON field names in spoken text.
 */

import type { DeskResult, DeskResultClassic, ConvictionDeskResult, ConvictionDeskOutput } from "@/lib/strategistDeskResult";
import type { BlockReason, StrategistOutcome } from "@/components/StrategistV2Card";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ORDINAL_ONES = [
  "zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth",
  "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth",
  "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second",
  "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh",
  "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first",
];

function ordinalDay(d: number): string {
  if (d >= 1 && d <= 31) return ORDINAL_ONES[d] ?? `${d}th`;
  return String(d);
}

function smallIntToWords(n: number): string {
  if (n < 0) return `negative ${smallIntToWords(-n)}`;
  if (n === 0) return "zero";
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${tens[t]} ${ones[o]}` : tens[t];
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const head = `${ones[h]} hundred`;
    return rest ? `${head} ${smallIntToWords(rest)}` : head;
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000);
    const rest = n % 1000;
    const head = `${smallIntToWords(th)} thousand`;
    return rest ? `${head} ${smallIntToWords(rest)}` : head;
  }
  return String(n);
}

/** Whole dollars and cents as spoken English (e.g. 4.96 -> "four dollars and ninety-six cents"). */
export function speakMoney(amount: number): string {
  const neg = amount < 0;
  const a = Math.abs(amount);
  const dollars = Math.floor(a + 1e-9);
  const cents = Math.round((a - dollars) * 100 + 1e-9) % 100;
  const core = `${smallIntToWords(dollars)} dollar${dollars === 1 ? "" : "s"} and ${smallIntToWords(cents)} cent${cents === 1 ? "" : "s"}`;
  return neg ? `negative ${core}` : core;
}

/** Strike / ratio numbers for spreads: 150 -> "one fifty" style for common option strikes. */
export function speakStrike(n: number): string {
  if (n < 0) return `negative ${speakStrike(-n)}`;
  if (n < 100) return smallIntToWords(n);
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (rest === 0) return `${smallIntToWords(hundreds)} hundred`;
    if (hundreds === 0) return smallIntToWords(rest);
    return `${smallIntToWords(hundreds)} hundred ${smallIntToWords(rest)}`.replace(" hundred ten", " hundred ten");
  }
  return smallIntToWords(n);
}

function spellTicker(ticker: string): string {
  return ticker
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .split("")
    .join(" ");
}

function formatIsoDateSpeech(iso: string): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return iso;
  return `${MONTHS[mo - 1]} ${ordinalDay(d)}, ${smallIntToWords(y)}`;
}

/** Spoken form for time stop (ISO date or short prose). */
export function speakTimeStop(raw: string, ticker: string): string {
  const t = raw.trim().split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return formatIsoDateSpeech(t);
  return preprocessForSpeech(raw, ticker);
}

/** Strip markdown fences, collapse whitespace, remove parentheses (content removed per spec). */
function stripTechnicalFormatting(s: string): string {
  let t = s.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/[`*_#>[\]]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

/**
 * Slash between two numbers (strikes / spread shorthand) -> "one fifty ... one thirty".
 */
function verbalizeStrikeSlashes(s: string): string {
  return s.replace(/\b(\d{1,6})\s*\/\s*(\d{1,6})\b/g, (_, a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return `${a} ${b}`;
    return `${speakStrike(na)} ... ${speakStrike(nb)}`;
  });
}

function replaceDollarAmounts(s: string): string {
  return s.replace(/\$\s*(-?\d+(?:\.\d+)?)/g, (_, num) => {
    const n = Number(num);
    if (!Number.isFinite(n)) return num;
    return speakMoney(n);
  });
}

function replaceIsoDates(s: string): string {
  return s.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (m) => formatIsoDateSpeech(m));
}

function injectSpelledTicker(s: string, ticker: string): string {
  const up = ticker.toUpperCase();
  if (!up) return s;
  const re = new RegExp(`\\b${up.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
  return s.replace(re, () => spellTicker(up));
}

/**
 * Preprocess free text for TTS: no vendor leakage fix here (prompts handle); formatting cleanup.
 */
export function preprocessForSpeech(raw: string, ticker: string): string {
  let t = stripTechnicalFormatting(raw);
  t = replaceDollarAmounts(t);
  t = replaceIsoDates(t);
  t = verbalizeStrikeSlashes(t);
  t = injectSpelledTicker(t, ticker);
  return t.replace(/\s+/g, " ").trim();
}

export type DeskSpeechSectionId =
  | "pm"
  | "vol"
  | "flow"
  | "catalyst"
  | "family_hypotheses"
  | "regime_synthesis"
  | "risk_of_ruin"
  | "positioning_context"
  | "self_check";

export interface DeskSpeechSection {
  id: DeskSpeechSectionId;
  /** Short label for UI, e.g. "Volatility" */
  label: string;
  /** Full text passed to SpeechSynthesisUtterance */
  text: string;
}

function sentence(label: string, value: string, ticker: string): string {
  const v = preprocessForSpeech(value, ticker);
  if (!v) return "";
  return `${label}: ${v}.`;
}

function buildPmSpeech(
  desk: DeskResultClassic,
  opts: { bannerTitle?: string; bannerBody?: string },
): string {
  const { pm, ticker } = desk;
  const t = ticker.toUpperCase();
  const parts: string[] = [];
  parts.push(`Desk report for ${spellTicker(t)}.`);
  if (opts.bannerTitle && opts.bannerBody) {
    parts.push(preprocessForSpeech(`${opts.bannerTitle}. ${opts.bannerBody}`, t));
  }
  parts.push(
    pm.decision === "trade"
      ? "The desk recommends a trade."
      : "The desk recommends passing on a new structure.",
  );
  if (pm.decision === "trade" && pm.structure) {
    const s = pm.structure;
    parts.push(
      `Structure is ${preprocessForSpeech(s.type.replace(/_/g, " "), t)}.`,
      `Expiry ${formatIsoDateSpeech(s.expiry) || preprocessForSpeech(s.expiry, t)}.`,
    );
    const net = speakMoney(Math.abs(s.credit_or_debit));
    parts.push(s.credit_or_debit < 0 ? `Net is a credit of ${net}.` : `Net is a debit of ${net}.`);
    for (const leg of s.legs) {
      const act = leg.action.toLowerCase();
      const typ = leg.type.toLowerCase();
      const k = speakStrike(Number(leg.strike) || 0);
      const exp = formatIsoDateSpeech(leg.expiration.split("T")[0] ?? leg.expiration) || leg.expiration;
      const q = leg.quantity && leg.quantity > 1 ? `, quantity ${smallIntToWords(leg.quantity)}` : "";
      parts.push(`${act} ${typ} at strike ${k}, expiration ${exp}${q}.`);
    }
  }
  if (pm.decision === "pass" && pm.watch_for) {
    parts.push(sentence("Watch for", pm.watch_for, t));
  }
  parts.push(sentence("Thesis", pm.thesis, t));
  if (pm.edge_check) parts.push(sentence("Edge check", pm.edge_check, t));
  if (pm.deviation_from_analysts && pm.deviation_from_analysts.trim().toLowerCase() !== "none") {
    parts.push(sentence("Deviation from analysts", pm.deviation_from_analysts, t));
  }
  parts.push(`Size is ${pm.size}.`, `Alignment is ${preprocessForSpeech(pm.whose_side.replace(/_/g, " "), t)}.`);
  if (pm.decision === "trade") {
    parts.push(
      `Profit target ${speakMoney(pm.exit_plan.profit_target)}.`,
      `Stop loss ${speakMoney(pm.exit_plan.stop_loss)}.`,
    );
    if (pm.exit_plan.time_stop) {
      parts.push(`Time stop ${speakTimeStop(pm.exit_plan.time_stop, t)}.`);
    }
  }
  parts.push(sentence("Biggest risk", pm.biggest_risk, t));
  if (desk.errors?.length) {
    parts.push("Notes.");
    for (const e of desk.errors) parts.push(preprocessForSpeech(e, t));
  }
  return parts.filter(Boolean).join(" ");
}

function buildVolSpeech(desk: DeskResultClassic): string {
  const { vol, ticker } = desk;
  const t = ticker.toUpperCase();
  return [
    sentence("Implied volatility state", vol.iv_state, t),
    sentence("Term structure", vol.term_structure, t),
    sentence("Skew", vol.skew, t),
    sentence("Implied versus realized", vol.implied_vs_realized, t),
    sentence("Read", vol.read, t),
  ].filter(Boolean).join(" ");
}

function buildFlowSpeech(desk: DeskResultClassic): string {
  const { flow, ticker } = desk;
  const t = ticker.toUpperCase();
  const lines = [
    sentence("Dominant flow", flow.dominant_flow, t),
    sentence("Institutional signal", flow.institutional_signal, t),
    sentence("Retail signal", flow.retail_signal, t),
  ];
  if (flow.key_strikes.length) {
    lines.push("Key strikes.");
    for (const ks of flow.key_strikes) {
      const strike = speakStrike(Number(ks.strike) || 0);
      const exp = formatIsoDateSpeech(ks.expiry) || ks.expiry;
      lines.push(
        `${ks.type} at ${strike}, expiry ${exp}. ${preprocessForSpeech(ks.observation, t)}.`,
      );
    }
  }
  lines.push(sentence("Read", flow.read, t));
  return lines.filter(Boolean).join(" ");
}

function buildCatalystSpeech(desk: DeskResultClassic): string {
  const { catalyst, ticker } = desk;
  const t = ticker.toUpperCase();
  return [
    sentence("Primary catalyst", catalyst.primary_catalyst, t),
    sentence("Bar to clear", catalyst.bar_to_clear, t),
    sentence("Asymmetry", catalyst.asymmetry, t),
    sentence("Historical pattern", catalyst.historical_pattern, t),
    sentence("Read", catalyst.read, t),
  ].filter(Boolean).join(" ");
}

function convictionDeskResultToClassic(dr: ConvictionDeskResult): DeskResultClassic | null {
  if (!dr.conviction) return null;
  const c = dr.conviction;
  return {
    mode: "solo_desk",
    ticker: dr.ticker,
    vol: c.vol,
    flow: c.flow,
    catalyst: c.catalyst,
    pm: c.pm,
    models: dr.models,
    errors: dr.errors,
  };
}

function buildRegimeSynthesisSpeech(c: ConvictionDeskOutput, ticker: string): string {
  const t = ticker.toUpperCase();
  return [
    `Regime read is ${preprocessForSpeech(c.regime_synthesis.regime_read.replace(/_/g, " "), t)}.`,
    `Strongest hypothesis is ${preprocessForSpeech(c.regime_synthesis.strongest_hypothesis.replace(/_/g, " "), t)}.`,
    preprocessForSpeech(c.regime_synthesis.synthesis, t),
  ]
    .filter(Boolean)
    .join(" ");
}

function buildRiskOfRuinSpeech(c: ConvictionDeskOutput, ticker: string): string {
  return preprocessForSpeech(c.risk_of_ruin, ticker.toUpperCase());
}

function buildPositioningSpeech(c: ConvictionDeskOutput, ticker: string): string {
  const t = ticker.toUpperCase();
  return [
    sentence("Crowd state", c.positioning_context.crowd_state.replace(/_/g, " "), t),
    sentence("Sell-side targets versus price", c.positioning_context.sell_side_targets_vs_price, t),
    sentence("Implied versus consensus", c.positioning_context.implied_vs_consensus, t),
    sentence("Upside fade risk", c.positioning_context.upside_fade_risk, t),
    sentence("Downside fade risk", c.positioning_context.downside_fade_risk, t),
  ].filter(Boolean).join(" ");
}

function buildFamilyHypothesesSpeech(c: ConvictionDeskOutput, ticker: string): string {
  const t = ticker.toUpperCase();
  const parts: string[] = ["Family hypotheses."];
  for (const h of c.family_hypotheses) {
    const fam = preprocessForSpeech(h.family.replace(/_/g, " "), t);
    parts.push(`Hypothesis ${fam}.`);
    if (h.family !== "pass") {
      parts.push(sentence("Structure", h.candidate_structure, t));
      parts.push(sentence("Entry math", h.entry_math, t));
    }
    parts.push(sentence("Thesis this family represents", h.thesis_this_family_represents, t));
    parts.push(`Fit score ${preprocessForSpeech(h.fit_score, t)}.`);
    parts.push(sentence("Reason for score", h.reason_for_score, t));
    parts.push(sentence("What would make it unfit", h.what_would_make_it_unfit, t));
  }
  return parts.filter(Boolean).join(" ");
}

function buildSelfCheckSpeech(c: ConvictionDeskOutput, ticker: string): string {
  const t = ticker.toUpperCase();
  const sc = c.self_check;
  return [
    `Each trade family priced with math: ${sc.each_family_priced_with_math ? "yes" : "no"}.`,
    sentence("Detail", sc.each_family_priced_with_math_reason, t),
    `Decision consistent with strongest hypothesis: ${sc.decision_consistent_with_strongest_hypothesis ? "yes" : "no"}.`,
    sentence("Detail", sc.decision_consistent_with_strongest_hypothesis_reason, t),
    `Call survives reverse family order: ${sc.call_survives_reverse_family_order ? "yes" : "no"}.`,
    sentence("Detail", sc.call_survives_reverse_family_order_reason, t),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Plain text for Conviction Desk (Solo Desk sections plus conviction-only fields). */
export function buildConvictionDeskCardPlainText(args: {
  deskResult: ConvictionDeskResult;
  generatedAt?: string | number | null;
  strategistOutcome?: StrategistOutcome;
  blockReason?: BlockReason;
}): string {
  const { deskResult, generatedAt, strategistOutcome, blockReason } = args;

  const when =
    generatedAt == null
      ? null
      : typeof generatedAt === "number"
        ? new Date(generatedAt).toLocaleString()
        : String(generatedAt);

  const lines: string[] = [];

  if (deskResult.convictionDeskJsonDegraded === "schema_validation_failed_after_retry") {
    lines.push(
      "CONVICTION DESK — OUTPUT PARSE FAILED",
      "The consolidated JSON did not match the required schema after retry.",
      "",
    );
  } else if (strategistOutcome === "ANALYSIS_INCOMPLETE" || blockReason?.category === "ANALYSIS_INCOMPLETE") {
    lines.push("ANALYSIS INCOMPLETE", blockReason?.detail ?? "The desk output did not validate after retry.", "");
  }

  const conviction = deskResult.conviction;
  if (!conviction) {
    lines.push(`PASS  ${deskResult.ticker}  CONVICTION DESK`);
    if (when) lines.push(`Generated: ${when}`);
    lines.push("", "Desk JSON could not be validated.");
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const { pm, vol, flow, catalyst } = conviction;
  const isTrade = pm.decision === "trade" && pm.structure != null;
  const errors = deskResult.errors;

  lines.push(`${isTrade ? "TRADE" : "PASS"}  ${deskResult.ticker}  CONVICTION DESK`);
  if (when) lines.push(`Generated: ${when}`);
  lines.push("");

  if (isTrade && pm.structure) {
    const s = pm.structure;
    lines.push(
      s.type.replace(/_/g, " ").toUpperCase(),
      `Expiry: ${s.expiry}  ·  ${s.credit_or_debit < 0 ? "Credit" : "Debit"}: $${Math.abs(s.credit_or_debit).toFixed(2)}`,
    );
    for (const leg of s.legs) {
      const q = leg.quantity && leg.quantity > 1 ? ` x${leg.quantity}` : "";
      lines.push(`${leg.action.toUpperCase()} ${leg.type.toUpperCase()} ${leg.strike} (${leg.expiration})${q}`);
    }
    lines.push("");
  }

  if (!isTrade && pm.watch_for) {
    lines.push("WATCH FOR", pm.watch_for, "");
  }

  lines.push("THESIS", pm.thesis, "");
  if (pm.edge_check) {
    lines.push("EDGE CHECK", pm.edge_check, "");
  }
  const dev = pm.deviation_from_analysts?.trim();
  if (dev && dev.toLowerCase() !== "none") {
    lines.push("DEVIATION FROM VOLATILITY SECTION", dev, "");
  }
  lines.push("SIZE", pm.size.toUpperCase());
  lines.push("ALIGNMENT", pm.whose_side.replace(/_/g, " "));

  if (isTrade) {
    lines.push("PROFIT TARGET", `$${pm.exit_plan.profit_target.toFixed(2)}`);
    lines.push("STOP LOSS", `$${pm.exit_plan.stop_loss.toFixed(2)}`);
    if (pm.exit_plan.time_stop) lines.push("TIME STOP", pm.exit_plan.time_stop);
  }
  lines.push("");

  lines.push("BIGGEST RISK", pm.biggest_risk, "");

  if (errors && errors.length > 0) {
    lines.push("NOTES / WARNINGS");
    for (const e of errors) lines.push(`- ${e}`);
    lines.push("");
  }

  lines.push("TOPIC SECTIONS", "");

  lines.push("— Volatility —");
  lines.push("IV State", vol.iv_state);
  lines.push("Term Structure", vol.term_structure);
  lines.push("Skew", vol.skew);
  lines.push("IV vs Realized", vol.implied_vs_realized);
  lines.push("Read", vol.read, "");

  lines.push("— Flow —");
  lines.push("Dominant Flow", flow.dominant_flow);
  lines.push("Institutional", flow.institutional_signal);
  lines.push("Retail", flow.retail_signal);
  if (flow.key_strikes.length > 0) {
    lines.push("Key Strikes");
    for (const ks of flow.key_strikes) {
      lines.push(`  ${ks.type.toUpperCase()} ${ks.strike} (${ks.expiry}): ${ks.observation}`);
    }
  }
  lines.push("Read", flow.read, "");

  lines.push("— Catalyst —");
  lines.push("Primary Catalyst", catalyst.primary_catalyst);
  lines.push("Bar to Clear", catalyst.bar_to_clear);
  lines.push("Asymmetry", catalyst.asymmetry);
  lines.push("Historical", catalyst.historical_pattern);
  lines.push("Read", catalyst.read, "");

  lines.push("— Family hypotheses —");
  for (const h of conviction.family_hypotheses) {
    lines.push(h.family.replace(/_/g, " ").toUpperCase());
    if (h.family !== "pass") {
      lines.push("Candidate structure", h.candidate_structure);
      lines.push("Entry math", h.entry_math);
    }
    lines.push("Thesis", h.thesis_this_family_represents);
    lines.push("Fit score", h.fit_score);
    lines.push("Reason", h.reason_for_score);
    lines.push("Unfit if", h.what_would_make_it_unfit, "");
  }

  lines.push("— Regime synthesis —");
  lines.push("Regime read", conviction.regime_synthesis.regime_read.replace(/_/g, " "));
  lines.push("Strongest hypothesis", conviction.regime_synthesis.strongest_hypothesis.replace(/_/g, " "));
  lines.push("Synthesis", conviction.regime_synthesis.synthesis, "");

  lines.push("— Risk of ruin —");
  lines.push(conviction.risk_of_ruin, "");

  lines.push("— Positioning context —");
  lines.push("Crowd state", conviction.positioning_context.crowd_state.replace(/_/g, " "));
  lines.push("Sell-side targets vs price", conviction.positioning_context.sell_side_targets_vs_price);
  lines.push("Implied vs consensus", conviction.positioning_context.implied_vs_consensus);
  lines.push("Upside fade risk", conviction.positioning_context.upside_fade_risk, "");
  lines.push("Downside fade risk", conviction.positioning_context.downside_fade_risk, "");

  lines.push("— Self check —");
  lines.push(
    "Each family priced with math",
    String(conviction.self_check.each_family_priced_with_math),
    conviction.self_check.each_family_priced_with_math_reason,
  );
  lines.push(
    "Decision consistent with strongest hypothesis",
    String(conviction.self_check.decision_consistent_with_strongest_hypothesis),
    conviction.self_check.decision_consistent_with_strongest_hypothesis_reason,
  );
  lines.push(
    "Survives reverse family order",
    String(conviction.self_check.call_survives_reverse_family_order),
    conviction.self_check.call_survives_reverse_family_order_reason,
    "",
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildDeskSpeechSections(
  deskResult: DeskResult,
  opts: { bannerTitle?: string; bannerBody?: string; generatedAt?: string | number | null },
): DeskSpeechSection[] {
  if (deskResult.mode === "conviction_desk") {
    const classic = convictionDeskResultToClassic(deskResult);
    if (!classic || !deskResult.conviction) {
      const t = deskResult.ticker.toUpperCase();
      return [
        {
          id: "pm",
          label: "Conviction Desk",
          text: preprocessForSpeech("Conviction desk output could not be validated.", t),
        },
      ];
    }
    const c = deskResult.conviction;
    return [
      { id: "pm", label: "Decision", text: buildPmSpeech(classic, opts) },
      { id: "vol", label: "Volatility", text: buildVolSpeech(classic) },
      { id: "flow", label: "Flow", text: buildFlowSpeech(classic) },
      { id: "catalyst", label: "Catalyst", text: buildCatalystSpeech(classic) },
      { id: "family_hypotheses", label: "Family hypotheses", text: buildFamilyHypothesesSpeech(c, deskResult.ticker) },
      { id: "regime_synthesis", label: "Regime synthesis", text: buildRegimeSynthesisSpeech(c, deskResult.ticker) },
      { id: "risk_of_ruin", label: "Risk of ruin", text: buildRiskOfRuinSpeech(c, deskResult.ticker) },
      { id: "positioning_context", label: "Positioning context", text: buildPositioningSpeech(c, deskResult.ticker) },
      {
        id: "self_check",
        label: "Self check",
        text: buildSelfCheckSpeech(c, deskResult.ticker),
      },
    ];
  }
  const classic = deskResult as DeskResultClassic;
  const pmText = buildPmSpeech(classic, opts);
  return [
    { id: "pm", label: "Decision", text: pmText },
    { id: "vol", label: "Volatility", text: buildVolSpeech(classic) },
    { id: "flow", label: "Flow", text: buildFlowSpeech(classic) },
    { id: "catalyst", label: "Catalyst", text: buildCatalystSpeech(classic) },
  ];
}
