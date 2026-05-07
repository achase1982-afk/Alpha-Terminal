/**
 * Conviction Desk user-prompt fragments: Solo Desk JSON shape plus four synthesis fields.
 * No em dashes in prose instructions (project convention).
 */

export const CONVICTION_DESK_ADDITIONS_INSTRUCTIONS = `

## CONVICTION DESK ADDITIONS (above and beyond Solo Desk)

After producing the vol, flow, catalyst, and pm sections, you must produce four additional fields:

1. regime_synthesis: One paragraph that explicitly synthesizes the four section reads. Given the vol state, flow signal, catalyst evaluation, and stock regime, does the setup support being long premium, short premium, neutral premium, or directional? State the read as a single enum value (regime_read) and write the supporting paragraph (synthesis). This is the "what is the story" field. Without this, the desk is producing data without committing to a coherent thesis.

2. risk_of_ruin: One sentence. The single biggest threat to this trade. The one thing that, if it happened, would cause maximum pain. Distinct from pm.biggest_risk because biggest_risk is general; risk_of_ruin is the specific failure path that destroys the position. For a calendar, the risk of ruin is a gap through the tent. For a directional debit, the risk of ruin is IV crush plus pin without movement. For short premium, the risk of ruin is realized exceeding implied with no time to adjust. Name it explicitly.

3. positioning_context: An object with four string fields. crowd_state is the enum value (crowded_long, crowded_short, balanced, unclear). sell_side_targets_vs_price is one sentence on how analyst targets compare to current price. implied_vs_consensus is one sentence on whether the implied move is bigger or smaller than what analysts are forecasting. fade_risk is one sentence on whether the consensus positioning creates a fade risk if the catalyst comes in as expected. This is the "is everyone already long" check that catches setups where bullish flow is contrarian rather than confirming.

4. structure_family_discipline: An object with four string fields plus an enum. directional_evaluated is one sentence describing the directional structure you considered (long calls, long puts, vertical spreads, diagonals). vol_surface_evaluated is one sentence on the vol-surface structure you considered (calendars, butterflies, iron flies, straddles, strangles). premium_evaluated is one sentence on the premium structure you considered (defined-risk credit spreads, iron condors). chosen_family is the enum value of the family the pm.structure belongs to. defense is one paragraph defending why the chosen family fits the regime better than the rejected families. This forces explicit evaluation of all three families on every setup, addressing the tendency to default to one family without considering alternatives.`;

/** Example JSON: Solo Desk top-level keys plus Conviction additions (mirrors ConvictionDeskOutputSchema). */
export const CONVICTION_DESK_FULL_JSON_SKELETON = `{
  "vol": {
    "iv_state": "<string>",
    "term_structure": "<string>",
    "skew": "<string>",
    "implied_vs_realized": "<string>",
    "read": "<string>"
  },
  "flow": {
    "dominant_flow": "<string>",
    "institutional_signal": "<string>",
    "retail_signal": "<string>",
    "key_strikes": [
      {"strike": <number>, "expiry": "<YYYY-MM-DD>", "type": "<call|put>", "observation": "<string>"}
    ],
    "read": "<string>"
  },
  "catalyst": {
    "primary_catalyst": "<string>",
    "bar_to_clear": "<string>",
    "asymmetry": "<string>",
    "historical_pattern": "<string>",
    "read": "<string>"
  },
  "pm": {
    "decision": "trade" | "pass",
    "structure": null | {
      "type": "<strategy name: bull_call_spread, iron_condor, etc.>",
      "legs": [{"type": "call"|"put", "strike": <number>, "action": "buy"|"sell", "expiration": "<YYYY-MM-DD>", "quantity": <optional number>}],
      "expiry": "<YYYY-MM-DD>",
      "credit_or_debit": <number, positive=debit negative=credit>
    },
    "thesis": "<string>",
    "edge_check": "<string>",
    "deviation_from_analysts": "<string or the single word none>",
    "size": "small" | "medium" | "large",
    "whose_side": "institutional_alignment" | "retail_fade" | "neither",
    "biggest_risk": "<string>",
    "exit_plan": {
      "profit_target": <number>,
      "stop_loss": <number>,
      "time_stop": "<YYYY-MM-DD or empty string>"
    },
    "watch_for": "<string>"
  },
  "regime_synthesis": {
    "regime_read": "long_premium" | "short_premium" | "neutral_premium" | "directional_long" | "directional_short" | "no_edge",
    "synthesis": "IV is bid into earnings while flow leans call-heavy; I synthesize a directional long premium read while respecting RV tail risk."
  },
  "risk_of_ruin": "A gap through the short wing on headline removes the vertical edge before I can adjust size or hedge.",
  "positioning_context": {
    "crowd_state": "crowded_long",
    "sell_side_targets_vs_price": "Median sell-side PT sits within one implied move of spot.",
    "implied_vs_consensus": "Listed ATM implied move is wider than consensus EPS swing assumptions.",
    "fade_risk": "If the catalyst prints clean, crowded long gamma could unwind into strength."
  },
  "structure_family_discipline": {
    "directional_evaluated": "Call vertical caps upside cost versus naked long delta.",
    "vol_surface_evaluated": "Calendar sells front IV into the catalyst window but fights a pure trend tape.",
    "premium_evaluated": "Iron condor collects meaty premium but leaves gap tail open.",
    "chosen_family": "directional",
    "defense": "Directional vertical fits breakout tape and defined risk matches IV bid; I reject premium iron until gap risk is priced for my size."
  }
}`;

export const CONVICTION_DESK_FINAL_SHAPE_GUARD = `

## FINAL SHAPE (Conviction Desk JSON)
- Top-level keys **only**: vol, flow, catalyst, pm, regime_synthesis, risk_of_ruin, positioning_context, structure_family_discipline.
- Do **not** emit the legacy Conviction memo shape (top-level regime / view / decision / failure_scenario / scenarios / exit_plan / self_grade / size from older builds).
- vol, flow, catalyst, pm must match the same nested shapes as Solo Desk exactly.
- regime_synthesis.regime_read must be one of the enum strings shown in the skeleton.
- When pm.decision is "pass" or pm.structure is null, structure_family_discipline.chosen_family must be "no_trade".
- When pm.decision is "trade", structure_family_discipline.chosen_family must match the family implied by pm.structure.type (directional, vol_surface, or premium) and your defense must support that choice.`;
