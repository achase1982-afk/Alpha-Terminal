import { CARD_BULLET_MAX_CHARS, CARD_BULLET_MAX_COUNT } from "./cardBulletCore.js";

const CARD_BULLET_RULES = `
Rules for EVERY bullet:
- **Exactly one sentence** — one claim, then stop; never two sentences in one bullet
- ${CARD_BULLET_MAX_CHARS} characters maximum including spaces — one line on a phone
- **3–4 bullets** per array when the source reasoning supports it (minimum 2, maximum ${CARD_BULLET_MAX_COUNT})
- One idea per bullet — no "+" and no comma-splicing two ideas
- No filler ("while", "highly elevated", "it is worth noting")
- Do not pad weak bullets to fill the array

**FORBIDDEN in both arrays** (already shown on the trade card or in the data snapshot):
- Trade structure: strikes, spreads, legs, DTE, delta, open interest, breakeven, max loss, max profit, credit/debit, "short put below spot", cushion vs spot
- Raw snapshot readouts: IVR, P/C ratio, IV rank, rel vol, or "tape mixed" without a forward thesis reason
- Trailing financials alone (revenue, EPS, margin) unless tied to **why the trade still works or breaks going forward**

Allowed: forward reasoning from your thesis — catalyst timing, mispricing, vol regime view, tape/sponsorship narrative, macro/event risk, post-earnings drift, scenario that flips the edge. Use dates and $ levels only when they express **thesis risk**, not structure placement.
`;

/**
 * Strategist Solo analyze / debate trade JSON — bullets from thesis reasoning only.
 */
export const CARD_FACE_BULLET_PROMPT = `
## CARD-FACE BULLETS (required — summary card only)

Populate **whyBullets** and **whatKillsBullets** after you write **thesis**, **bullInvalidation**, **bearInvalidation**, and **riskOfRuin**. Distill those fields — do **not** read the options chain table or invent bullets from leg math.

**whyBullets** (${CARD_BULLET_MAX_COUNT} max): Scan lines for **why this setup has edge** — distill your directional/vol thesis (mispricing, catalyst, drift, vol sale/crush thesis, tape/sponsorship, event window). Source: your **thesis** paragraph and verdict on edge.

**whatKillsBullets** (${CARD_BULLET_MAX_COUNT} max): Scan lines for **what breaks the thesis and loses money** — distill **riskOfRuin**, **bullInvalidation** / **bearInvalidation** (the side that kills the trade), and warnings. Source: analytical risk reasoning, not exit-plan math.

${CARD_BULLET_RULES}

Bad why: "$370 short put sits below spot" / "6/18 ATM IV 77.7 supports sale" / "Q1 revenue $43.84B" (structure or data readout)
Good why: "Post-earnings drift after May 28 beat" / "Vol still rich vs realized after gap" / "Call flow confirms post-print chase"

Bad kills: "Close below $366 breakeven" / "Gap below $350 maxes risk" (restates structure card)
Good kills: "Jun 17 FOMC shock reprices vol against short premium" / "AI server demand reversal kills bull case"
`;

/**
 * Solo Desk **pm** block — bullets are explicit arrays, not clipped from structure fields.
 */
export const SOLO_DESK_CARD_BULLET_PROMPT = `
## CARD-FACE BULLETS (pm — required on trade decisions)

When **pm.decision** is **trade**, you MUST output **why_bullets** and **what_kills_bullets** as string arrays (in addition to the thesis paragraph and biggest_risk).

Derive bullets only from your desk reasoning:
- **why_bullets**: from **pm.thesis** and your integrated vol/flow/catalyst read — why the mispricing exists and why this expression wins.
- **what_kills_bullets**: from **pm.biggest_risk**, **risk_of_ruin** (Solo consolidated), and what would invalidate the thesis — specific scenarios, not generic risk labels.

${CARD_BULLET_RULES}

The **thesis** and **biggest_risk** strings remain full paragraphs for the report; bullets are the phone-sized distillation. Do not copy breakeven, stop, or strike ladder from **pm.structure** or **exit_plan**.
`;

/**
 * Conviction Desk **pm** block — bullets from PM synthesis and risk sections.
 */
export const CONVICTION_DESK_CARD_BULLET_PROMPT = `
## CARD-FACE BULLETS (pm — required on trade decisions)

When **pm.decision** is **trade**, output **why_bullets** and **what_kills_bullets** (string arrays, 3–4 items each when supported).

Sources (write these sections first, then distill):
- **why_bullets**: **regime_synthesis.synthesis**, **pm.thesis**, and the chosen **family_hypotheses** entry for the winning family — forward edge only.
- **what_kills_bullets**: **risk_of_ruin**, **pm.biggest_risk**, and downside scenarios from the non-winning families or vol hypothesis **what_would_make_it_unfit** lines that apply to the traded structure.

${CARD_BULLET_RULES}

Do not restate **pm.structure** legs, **entry_math**, or exit targets. The trade card already shows structure; bullets carry thesis and kill **reasoning** only.
`;
