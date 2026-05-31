import { CARD_BULLET_MAX_CHARS, CARD_BULLET_MAX_COUNT } from "./cardBulletCore.js";

/** Shared instruction block for Strategist trade JSON (solo + debate PM). */
export const CARD_FACE_BULLET_PROMPT = `
## CARD-FACE BULLETS (required — user reads these at a glance)

You MUST populate **whyBullets** and **whatKillsBullets** using web search, cited headlines, the data package, and your chosen structure. These are NOT the long thesis — they are scan lines on the trade card.

**whyBullets** (max ${CARD_BULLET_MAX_COUNT}): Why we are putting this trade on — tailwinds, edge, catalyst, tape, vol/flow facts that support the position. Use real ticker-specific facts from search and data (levels, dates, IVR, headlines).

**whatKillsBullets** (max ${CARD_BULLET_MAX_COUNT}): What invalidates the trade — precise failure modes (levels, events, vol regime, macro, earnings, news that flips the thesis).

Rules for EVERY bullet:
- ${CARD_BULLET_MAX_CHARS} characters maximum including spaces — one line on a phone (no separate word limit)
- Complete thought; no fragment that continues on the next line
- No filler ("while", "the", "highly elevated", "it is worth noting")
- Do not pad to reach the count — use 2–${CARD_BULLET_MAX_COUNT} bullets only when you have real points; never add weak bullets to fill the array
- One idea per bullet — never join two points with "+" or a comma; split into separate bullets or drop the weaker point
- Name the concrete fact (strike, date, headline theme, IVR number from data) — not vague labels alone ("vol regime", "tape risk", "macro headwind")
- Be pointed: a busy trader should know why and what breaks in one glance
- Prefer concrete facts: "$425 short put", "May 28 earnings", "IVR 72", headline theme from search
- For IVR and P/C on the card, cite the numeric values from the data package (e.g. "IVR 72") — do NOT use \`{{IVR}}\` or \`{{PC_RATIO}}\` placeholders in whyBullets or whatKillsBullets
- Digits, $, and dates are allowed and encouraged when specific

Bad: "While front-month implied volatility is highly elevated with an IVR"
Bad: "Rich premium + firm tape" (two ideas joined)
Bad: "Vol regime, macro risk" (comma-spliced pair)
Bad: "Tape risk" (vague label with no fact)
Good: "DELL IVR 72 — rich premium to sell"
Good: "May 28 earnings drift supports hold"
Good: "Close below $425 kills bull put"
`;
