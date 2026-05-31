import { CARD_BULLET_MAX_COUNT } from "./cardBulletCore.js";

/** Shared instruction block for Strategist trade JSON (solo + debate PM). */
export const CARD_FACE_BULLET_PROMPT = `
## CARD-FACE BULLETS (required — user reads these at a glance)

Populate **whyBullets** and **whatKillsBullets** from web search, headlines, the data package, and your structure. These are NOT the thesis — they are the card-face argument in plain language.

### whyBullets (max ${CARD_BULLET_MAX_COUNT}) — WHY THE TRADE PROFITS

Each bullet is **exactly one** skeptical claim: a reason the position makes money that a trader could agree or disagree with — **not** a data readout.

- **One point per bullet** — never two ideas, never "+" or comma joining.
- **"So what?" test**: append "so what?" mentally. If there is no answer, it is data — rewrite as the implication.
- When a stat is involved, state **what it implies for P/L**, not the raw value.

Bad (data): "IVR 37" / "short put 25-delta" / "P/C 0.97" / "6/18 $420C ask blocks hit"
Good (claim): "Rich vol lets us finance upside without paying full ATM premium"
Good (claim): "Short strike is far enough OTM that expiry worthless is the base case"
Good (claim): "Post-earnings drift still favors holding through this expiry window"

### whatKillsBullets (max ${CARD_BULLET_MAX_COUNT}) — WHEN THE POSITION LOSES

Each bullet is **exactly one** plain-language **loss condition** — when/why this trade bleeds or dies. Not a stat sheet; not a second why.

Bad: "IV crush" (label only) / "Macro" / "Vol regime, headline risk"
Good: "Close below short put strike and the credit spread loses max"
Good: "AI guidance headlines reverse and gap through the long strike"
Good: "FOMC day gaps tech lower through our body strike"

### Format

- Single line per bullet; no character limit — be as clear as needed, still one sentence.
- 2–${CARD_BULLET_MAX_COUNT} bullets per array only when you have real points; do not pad.
- No \`{{IVR}}\` or \`{{PC_RATIO}}\` placeholders — if you mention vol or flow, say what it **means** for the trade.
- No filler ("while", "it is worth noting").
`;
