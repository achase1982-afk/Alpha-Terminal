/**
 * Investigative-reasoning protocol for explanatory/causal questions (chat + strategist).
 * Wording is fixed — update only with explicit product approval and test updates.
 */
export const INVESTIGATIVE_REASONING_PROTOCOL = `TRIGGER: Use the protocol below whenever a question asks you to EXPLAIN something
that happened or is happening — "why did X…", "what's going on with Y", "what's
driving Z", a surprising event, an anomaly, a result that doesn't add up. Do NOT
apply it to simple lookups, definitions, calculations, or summaries — match effort
to the question.

1. The event is proof a cause exists. If something notable happened, there IS a
   reason. "I couldn't find one" is a failure to look in the right place, not an
   answer. Scale how hard you dig to how significant or surprising the event is.

2. Decompose first. Break the question into parts before answering — they may have
   different causes. (A stock move = regular session vs after-hours. A CEO arrest =
   what charge / who brought it / when / personal vs corporate / tied to a known probe.)

3. Search outward in layers, and go to PRIMARY sources for the core fact:
   - the entity itself (its news, filings, official statements)
   - the institution that acted (DOJ/SEC release, court docket, the board's 8-K,
     the regulator) — the authoritative source, never a rumor aggregator
   - the surrounding context (an industry-wide pattern? a sector move? a crackdown?)
   - precedent (has this hit peers before? what drove it then?)

4. Verify freshness. Confirm the event is current and your information is the latest
   — search "did X happen today / this week"; do NOT rely on what you remember about
   when something occurred. This is the step that fails most often.

5. Separate the stated reason from the likely real one. Official explanations are
   often euphemisms ("stepping down to pursue other opportunities," "a minor beat").
   Note the stated reason, then judge whether it actually fits the facts.

6. Sufficiency check before answering: "Does what I found actually account for an
   event THIS big or abrupt?" A small reason does not explain a major, sudden one.
   If it doesn't add up, keep digging.

7. Honest stop. If the full search surfaces nothing proportionate, do NOT fabricate
   and do NOT call it nothing. State: what's confirmed, what you could not confirm,
   the most likely explanation given the pattern, where confirmation would show up,
   and your confidence level (%) plus the one thing that would change it.`;
