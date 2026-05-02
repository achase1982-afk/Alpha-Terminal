/**
 * Builds Web Speech–friendly section scripts for the Strategist Desk card.
 * Presentation-only: natural phrasing, no raw JSON field names in spoken text.
 */

import type { DeskResult } from "@/lib/strategistDeskResult";

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

export type DeskSpeechSectionId = "pm" | "vol" | "flow" | "catalyst";

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
  desk: DeskResult,
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

function buildVolSpeech(desk: DeskResult): string {
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

function buildFlowSpeech(desk: DeskResult): string {
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

function buildCatalystSpeech(desk: DeskResult): string {
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

export function buildDeskSpeechSections(
  deskResult: DeskResult,
  opts: { bannerTitle?: string; bannerBody?: string },
): DeskSpeechSection[] {
  const pmText = buildPmSpeech(deskResult, opts);
  return [
    { id: "pm", label: "Decision", text: pmText },
    { id: "vol", label: "Volatility", text: buildVolSpeech(deskResult) },
    { id: "flow", label: "Flow", text: buildFlowSpeech(deskResult) },
    { id: "catalyst", label: "Catalyst", text: buildCatalystSpeech(deskResult) },
  ];
}
