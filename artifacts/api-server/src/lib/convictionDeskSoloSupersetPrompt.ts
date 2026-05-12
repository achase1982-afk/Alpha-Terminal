/**
 * Conviction Desk user-prompt fragments: Solo Desk JSON shape plus deliberation-before-commitment fields.
 * No em dashes in prose instructions (project convention).
 */

export const CONVICTION_DESK_ADDITIONS_INSTRUCTIONS = `
## CONVICTION DESK ADDITIONS (deliberation before commitment)

After producing the vol, flow, and catalyst sections, you must produce the family_hypotheses array, then regime_synthesis, then pm, then the risk and self_check blocks — in that order. The pm.decision is constrained by what survives family_hypotheses. You may not propose a structure in pm that was not first evaluated as a hypothesis.

1. family_hypotheses: An array of exactly four objects, one per family enum (long_vol, short_vol, directional, pass). Each trade-family hypothesis must carry:
   - family: enum value (long_vol | short_vol | directional)
   - candidate_structure: the specific structure under consideration, named with strikes and expiry. Examples: "8/21 90/100 call vertical", "5/15-vs-6/18 ATM calendar", "8/21 80/85 call backspread (sell 1 80C, buy 2 85C)". Choose the cleanest expression of the family for this surface.
   - entry_math: concrete numbers from the chain — entry mid (positive for debit, negative for credit), breakeven price(s), max profit, max loss, spread width. Show the work in one string.
   - thesis_this_family_represents: one phrase naming the market view this family expresses on this surface ("ride post-earnings vol re-bid before crush", "harvest IV richness against pinning resistance", "mirror the institutional Jan-2027 footprint with defined risk").
   - fit_score: enum (high | medium | low | unfit)
   - reason_for_score: one sentence on why this surface, flow, and catalyst combination scores this family that way.
   - what_would_make_it_unfit: one sentence naming the specific surface, flow, or tape change that would invalidate this family.

   The pass hypothesis has a different shape:
   - family: "pass"
   - candidate_structure: null
   - entry_math: null
   - thesis_this_family_represents: one phrase ("no edge worth defending until X clarifies" or similar).
   - fit_score: enum (high | medium | low | unfit)
   - reason_for_score: one sentence on why pass beats each of the three trade families on this specific surface.
   - what_would_make_it_unfit: one sentence on what would make pass the wrong call.

   You must price each trade family with real math. One-sentence dismissals are not acceptable. If the directional family does not get the same depth of math as the vol_surface family, you have not done the work. Edge can be in any family — evaluate long_vol, short_vol, and directional as peers.

2. regime_synthesis: An object with three fields:
   - regime_read: enum from {short_premium_neutral, short_premium_directional, long_premium_neutral, long_premium_directional, pure_directional_long, pure_directional_short, no_edge}.
   - strongest_hypothesis: enum (long_vol | short_vol | directional | pass) — must reference one of the four family_hypotheses entries.
   - synthesis: one paragraph tying the surface read (vol + flow + catalyst observations) to the chosen hypothesis, naming why this hypothesis beats the other three on this specific setup.

3. pm.decision and pm.structure constraints: If pm.decision is "trade", pm.structure must be the structure named in the strongest_hypothesis candidate_structure. You may not propose a structure that was not enumerated as a hypothesis. If pm.decision is "pass", strongest_hypothesis must be "pass" — meaning the pass case beat each of the three trade families on its own merits, not because no trade family was meaningfully evaluated.

4. risk_of_ruin: one sentence naming the specific failure path that destroys the position. Distinct from pm.biggest_risk — that is general, this is the specific scenario ("gap through the short wing on headline removes the vertical edge before adjustment is possible", "IV crush plus pin without movement on the debit vertical").

5. positioning_context: An object with the following fields:
   - crowd_state: enum (crowded_long | crowded_short | balanced | unclear)
   - sell_side_targets_vs_price: one sentence on how analyst targets compare to current price.
   - implied_vs_consensus: one sentence on whether the implied move is bigger or smaller than what analysts are forecasting.
   - upside_fade_risk: one sentence on whether crowded long positioning creates fade risk if the catalyst confirms (post-print exhaustion, gamma unwind into strength).
   - downside_fade_risk: one sentence on whether crowded short positioning creates fade risk if the catalyst confirms (short squeeze, capitulation cover).

6. self_check: An object with three booleans plus three reason strings:
   - each_family_priced_with_math: boolean (true only if long_vol, short_vol, and directional each got concrete strikes, breakeven, max profit, max loss in entry_math).
   - each_family_priced_with_math_reason: one sentence — if false, name which family was not priced.
   - decision_consistent_with_strongest_hypothesis: boolean (true if pm.structure matches the strongest_hypothesis family and candidate_structure).
   - decision_consistent_with_strongest_hypothesis_reason: one sentence — if false, explain the mismatch.
   - call_survives_reverse_family_order: boolean (true if you would land on the same strongest_hypothesis had you evaluated families in reverse order — directional first, then short_vol, then long_vol, then pass).
   - call_survives_reverse_family_order_reason: one sentence.

PASS is correct only when the pass hypothesis beats each of the three trade families on its own merits. An A-grade trade missed is a Sharpe drag, same as a B-grade trade taken.
`;

/** Example JSON: Solo Desk top-level keys plus Conviction additions (mirrors ConvictionDeskOutputSchema). */
export const CONVICTION_DESK_FULL_JSON_SKELETON = `
{
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
  "family_hypotheses": [
    {
      "family": "long_vol",
      "candidate_structure": "<e.g. '8/21 80/85 call backspread (sell 1 80C, buy 2 85C)'>",
      "entry_math": "<e.g. '0.40 credit, breakeven 84.60, max profit unlimited above 85, max loss 4.60 at 85 pin'>",
      "thesis_this_family_represents": "<one phrase>",
      "fit_score": "<high|medium|low|unfit>",
      "reason_for_score": "<one sentence>",
      "what_would_make_it_unfit": "<one sentence>"
    },
    {
      "family": "short_vol",
      "candidate_structure": "<e.g. '5/15 80/85/95/100 iron condor'>",
      "entry_math": "<e.g. '1.20 credit on 5-wide wings, breakevens 83.80 and 96.20, max loss 3.80'>",
      "thesis_this_family_represents": "<one phrase>",
      "fit_score": "<high|medium|low|unfit>",
      "reason_for_score": "<one sentence>",
      "what_would_make_it_unfit": "<one sentence>"
    },
    {
      "family": "directional",
      "candidate_structure": "<e.g. '8/21 90/100 call vertical'>",
      "entry_math": "<e.g. '2.30 debit on 10-wide, breakeven 92.30, max profit 7.70 above 100, max loss 2.30'>",
      "thesis_this_family_represents": "<one phrase>",
      "fit_score": "<high|medium|low|unfit>",
      "reason_for_score": "<one sentence>",
      "what_would_make_it_unfit": "<one sentence>"
    },
    {
      "family": "pass",
      "candidate_structure": null,
      "entry_math": null,
      "thesis_this_family_represents": "<one phrase>",
      "fit_score": "<high|medium|low|unfit>",
      "reason_for_score": "<one sentence on why pass beats each of the three trade families on this surface>",
      "what_would_make_it_unfit": "<one sentence>"
    }
  ],
  "regime_synthesis": {
    "regime_read": "<short_premium_neutral|short_premium_directional|long_premium_neutral|long_premium_directional|pure_directional_long|pure_directional_short|no_edge>",
    "strongest_hypothesis": "<long_vol|short_vol|directional|pass>",
    "synthesis": "<one paragraph tying surface read to chosen hypothesis, naming why this hypothesis beats the other three on this setup>"
  },
  "pm": {
    "decision": "trade" | "pass",
    "structure": null | {
      "type": "<strategy name matching the strongest_hypothesis candidate_structure>",
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
  "risk_of_ruin": "<one sentence — specific failure path>",
  "positioning_context": {
    "crowd_state": "<crowded_long|crowded_short|balanced|unclear>",
    "sell_side_targets_vs_price": "<one sentence>",
    "implied_vs_consensus": "<one sentence>",
    "upside_fade_risk": "<one sentence on whether crowded long fades if catalyst confirms>",
    "downside_fade_risk": "<one sentence on whether crowded short fades if catalyst confirms>"
  },
  "self_check": {
    "each_family_priced_with_math": <true|false>,
    "each_family_priced_with_math_reason": "<one sentence>",
    "decision_consistent_with_strongest_hypothesis": <true|false>,
    "decision_consistent_with_strongest_hypothesis_reason": "<one sentence>",
    "call_survives_reverse_family_order": <true|false>,
    "call_survives_reverse_family_order_reason": "<one sentence>"
  }
}
`;

export const CONVICTION_DESK_FINAL_SHAPE_GUARD = `
## FINAL SHAPE (Conviction Desk JSON)
- Top-level keys only: vol, flow, catalyst, family_hypotheses, regime_synthesis, pm, risk_of_ruin, positioning_context, self_check. The legacy structure_family_discipline key is removed. Do not emit it.
- Field order in the output must match the order above. family_hypotheses must appear before regime_synthesis, which must appear before pm. Generate the analysis in this order so deliberation precedes commitment.
- vol, flow, catalyst must match the same nested shapes as Solo Desk exactly.
- family_hypotheses must contain exactly four entries with family values long_vol, short_vol, directional, pass (in that order). The three trade families must each carry concrete entry_math with strikes, breakevens, max profit, and max loss. The pass entry has candidate_structure and entry_math set to null but must carry thesis_this_family_represents, fit_score, reason_for_score, and what_would_make_it_unfit.
- regime_synthesis.regime_read must be one of the seven enum strings. regime_synthesis.strongest_hypothesis must reference one of the four family_hypotheses entries by family value.
- When pm.decision is "trade", pm.structure.type must reflect the candidate_structure from the strongest_hypothesis. When pm.decision is "pass", regime_synthesis.strongest_hypothesis must be "pass".
- self_check booleans must reflect actual state. If each_family_priced_with_math is false, the run is incomplete.
`;
