/** Normalize chain draft snapshots for exact equality (reviewer #732/#733). */

function contractSymbol(contract) {
  if (!contract || typeof contract !== "object") return "";
  const c = contract;
  return String(c.schwabSymbol ?? c.symbol ?? c.streamKey ?? "").trim();
}

/**
 * @param {ReturnType<NonNullable<Window['__AT_CHAIN_DRAFT_SNAPSHOT']>> | null | undefined} snap
 */
export function normalizeChainDraftSnapshot(snap) {
  if (!snap?.legs?.length) return null;
  const legs = [...snap.legs]
    .map((leg) => ({
      key: leg.key,
      side: leg.side,
      type: leg.type,
      expiration: leg.expiration,
      strike: Number(leg.contract?.strike),
      contractSymbol: contractSymbol(leg.contract),
      qty: Number(snap.legQuantities?.[leg.key] ?? 1),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    symbol: snap.symbol,
    legs,
    limitPrice: String(snap.sheet?.limitPrice ?? ""),
    limitLocked: Boolean(snap.sheet?.limitLocked),
    chainTicketOpen: Boolean(snap.chainTicketOpen),
  };
}

export function assertDraftSnapshotsExact(before, after) {
  const errors = [];
  const b = normalizeChainDraftSnapshot(before);
  const a = normalizeChainDraftSnapshot(after);
  if (!b || !a) {
    errors.push("missing snapshot");
    return errors;
  }
  if (b.symbol !== a.symbol) errors.push(`symbol: ${b.symbol} !== ${a.symbol}`);
  if (b.limitPrice !== a.limitPrice) errors.push(`limitPrice: ${JSON.stringify(b.limitPrice)} !== ${JSON.stringify(a.limitPrice)}`);
  if (b.limitLocked !== a.limitLocked) errors.push(`limitLocked: ${b.limitLocked} !== ${a.limitLocked}`);
  if (b.legs.length !== a.legs.length) {
    errors.push(`leg count: ${b.legs.length} !== ${a.legs.length}`);
    return errors;
  }
  for (let i = 0; i < b.legs.length; i += 1) {
    const bl = b.legs[i];
    const al = a.legs[i];
    for (const field of ["key", "side", "type", "expiration", "contractSymbol"]) {
      if (bl[field] !== al[field]) errors.push(`leg[${i}].${field}: ${JSON.stringify(bl[field])} !== ${JSON.stringify(al[field])}`);
    }
    if (bl.strike !== al.strike || Number.isNaN(bl.strike)) errors.push(`leg[${i}].strike: ${bl.strike} !== ${al.strike}`);
    if (bl.qty !== al.qty) errors.push(`leg[${i}].qty: ${bl.qty} !== ${al.qty}`);
  }
  const hasBuy = b.legs.some((l) => l.side === "ask");
  const hasSell = b.legs.some((l) => l.side === "bid");
  if (!hasBuy || !hasSell) errors.push("expected one BUY (ask) and one SELL (bid) leg");
  if (b.legs.some((l) => l.qty !== 3)) errors.push("expected qty 3 on every leg");
  return errors;
}