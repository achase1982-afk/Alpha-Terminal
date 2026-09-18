/**
 * Consensus mode: several models analyze the same data package independently and
 * a trade ships only where they agree on what to do.
 *
 * This is not Debate. In Debate the models see each other's arguments, which is
 * exactly the condition under which language models converge on whoever spoke
 * with most confidence rather than on whoever is right. Here each member runs
 * blind, and agreement is computed in code from the structures they returned,
 * not asserted by an arbitrator.
 *
 * Agreement is deliberately structural rather than textual. Two models can
 * describe the same trade in completely different prose, so direction and
 * strategy family are derived from the legs themselves.
 */

export type ConsensusDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type ConsensusFamily =
  | "single"
  | "vertical"
  | "calendar"
  | "diagonal"
  | "straddle"
  | "strangle"
  | "butterfly"
  | "iron"
  | "ratio"
  | "other";

export interface ConsensusLeg {
  type: "call" | "put";
  strike: number;
  action: "buy" | "sell";
  expiration: string;
  quantity?: number;
}

export interface ConsensusMemberInput {
  /** Label for the model that produced this card, for the audit trail. */
  label: string;
  legs: readonly ConsensusLeg[];
  strategy: string;
  confidence: number;
}

export interface ConsensusMember extends ConsensusMemberInput {
  direction: ConsensusDirection;
  family: ConsensusFamily;
}

export interface ConsensusVerdict {
  agreed: boolean;
  direction: ConsensusDirection | null;
  family: ConsensusFamily | null;
  /** Mean confidence across members, rounded. */
  meanConfidence: number;
  /** Index of the member whose card should ship, or -1 when there is no agreement. */
  winnerIndex: number;
  members: ConsensusMember[];
  /** One sentence for the card and the telemetry row. */
  note: string;
}

function signOf(action: "buy" | "sell"): number {
  return action === "buy" ? 1 : -1;
}

function qtyOf(leg: ConsensusLeg): number {
  const q = leg.quantity;
  return Number.isFinite(q) && (q as number) > 0 ? (q as number) : 1;
}

/**
 * Direction from the payoff at the extremes rather than from the strategy name.
 *
 * At a very high underlying the puts are worthless, so the upside behavior is
 * the net long call count, or when that nets to zero, the strike-weighted call
 * position (which is what separates a bull call spread from a bear call
 * spread). The mirror argument gives the downside. A structure that gains on
 * the way up and not on the way down is bullish, one that does both is neutral.
 */
export function classifyDirection(legs: readonly ConsensusLeg[]): ConsensusDirection {
  let netCalls = 0;
  let callStrikeWeight = 0;
  let netPuts = 0;
  let putStrikeWeight = 0;

  for (const leg of legs) {
    const s = signOf(leg.action) * qtyOf(leg);
    if (leg.type === "call") {
      netCalls += s;
      callStrikeWeight += s * leg.strike;
    } else {
      netPuts += s;
      putStrikeWeight += s * leg.strike;
    }
  }

  const upsideGain = netCalls !== 0 ? netCalls : -callStrikeWeight;
  const downsideGain = netPuts !== 0 ? netPuts : putStrikeWeight;

  const score = Math.sign(upsideGain) - Math.sign(downsideGain);
  if (score > 0) return "BULLISH";
  if (score < 0) return "BEARISH";
  return "NEUTRAL";
}

/** Structure family from the shape of the legs, ignoring whatever the model called it. */
export function classifyFamily(legs: readonly ConsensusLeg[]): ConsensusFamily {
  if (legs.length === 0) return "other";
  if (legs.length === 1) return "single";

  const calls = legs.filter((l) => l.type === "call");
  const puts = legs.filter((l) => l.type === "put");
  const expirations = new Set(legs.map((l) => l.expiration));
  const strikes = new Set(legs.map((l) => l.strike));
  const sameType = calls.length === 0 || puts.length === 0;
  const totalBuy = legs.filter((l) => l.action === "buy").reduce((a, l) => a + qtyOf(l), 0);
  const totalSell = legs.filter((l) => l.action === "sell").reduce((a, l) => a + qtyOf(l), 0);
  const unbalanced = totalBuy !== totalSell;

  if (legs.length === 2 && sameType) {
    if (expirations.size > 1) return strikes.size === 1 ? "calendar" : "diagonal";
    if (unbalanced) return "ratio";
    return "vertical";
  }

  if (legs.length === 2 && !sameType) {
    const sameSide = legs[0].action === legs[1].action;
    if (!sameSide) return "other";
    return strikes.size === 1 ? "straddle" : "strangle";
  }

  if (legs.length === 4 && calls.length === 2 && puts.length === 2) return "iron";
  if (legs.length >= 3 && sameType) return unbalanced ? "ratio" : "butterfly";

  return "other";
}

export function classifyMember(m: ConsensusMemberInput): ConsensusMember {
  return { ...m, direction: classifyDirection(m.legs), family: classifyFamily(m.legs) };
}

/**
 * Agreement rule: every member must land on the same direction and the same
 * structure family. Anything less is a pass, because a split desk is
 * information, not an inconvenience to average away. The shipped card is the
 * one from the most confident member, carrying the mean confidence of the group
 * rather than its own, so a lone optimist cannot lift the number.
 */
export function evaluateConsensus(inputs: readonly ConsensusMemberInput[]): ConsensusVerdict {
  const members = inputs.map(classifyMember);
  const base: Omit<ConsensusVerdict, "agreed" | "direction" | "family" | "winnerIndex" | "note"> = {
    meanConfidence: members.length
      ? Math.round(members.reduce((a, m) => a + (Number.isFinite(m.confidence) ? m.confidence : 0), 0) / members.length)
      : 0,
    members,
  };

  if (members.length === 0) {
    return { ...base, agreed: false, direction: null, family: null, winnerIndex: -1, note: "No consensus members returned a card." };
  }

  if (members.length === 1) {
    return {
      ...base,
      agreed: true,
      direction: members[0].direction,
      family: members[0].family,
      winnerIndex: 0,
      note: `Only one consensus member was available (${members[0].label}); shipped without cross-model agreement.`,
    };
  }

  const directions = [...new Set(members.map((m) => m.direction))];
  const families = [...new Set(members.map((m) => m.family))];

  const describe = (key: "direction" | "family") =>
    members.map((m) => `${m.label} ${m[key].toLowerCase()}`).join(", ");

  if (directions.length > 1) {
    return {
      ...base,
      agreed: false,
      direction: null,
      family: null,
      winnerIndex: -1,
      note: `Consensus members disagreed on direction: ${describe("direction")}.`,
    };
  }

  if (families.length > 1) {
    return {
      ...base,
      agreed: false,
      direction: directions[0],
      family: null,
      winnerIndex: -1,
      note: `Consensus members agreed the setup is ${directions[0].toLowerCase()} but disagreed on structure: ${describe("family")}.`,
    };
  }

  let winnerIndex = 0;
  for (let i = 1; i < members.length; i += 1) {
    if (members[i].confidence > members[winnerIndex].confidence) winnerIndex = i;
  }

  return {
    ...base,
    agreed: true,
    direction: directions[0],
    family: families[0],
    winnerIndex,
    note: `${members.length}-model consensus: all agreed on a ${directions[0].toLowerCase()} ${families[0]} structure (${members
      .map((m) => `${m.label} ${m.confidence}`)
      .join(", ")}). Shipped ${members[winnerIndex].label}'s card at the group mean confidence of ${base.meanConfidence}.`,
  };
}
