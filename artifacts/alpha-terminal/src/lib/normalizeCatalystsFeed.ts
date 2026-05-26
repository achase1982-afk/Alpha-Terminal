import {
  CATALYST_DRIFT_SESSION_COUNT,
  DEFAULT_CATALYST_GATE_SETTINGS,
  normalizeCatalystGateSettings,
  type CatalystCard,
  type CatalystSessionSnapshot,
  type CatalystsFeed,
} from "@workspace/catalysts-types";

type LegacyFeed = CatalystsFeed & { benchmarkDrift5dPct?: number | null };
type LegacySnapshot = CatalystSessionSnapshot & {
  cumulative2d?: number;
  cumulative4d?: number;
  sessionMovesRawPct?: number[];
};

function padMoves(moves: number[], len: number): number[] {
  if (moves.length >= len) return moves.slice(-len);
  return [...Array.from({ length: len - moves.length }, () => 0), ...moves];
}

function normalizeSnapshot(raw: LegacySnapshot): CatalystSessionSnapshot {
  const moves = padMoves(raw.sessionMovesPct ?? [], CATALYST_DRIFT_SESSION_COUNT);
  const rawMoves = padMoves(
    raw.sessionMovesRawPct ?? raw.sessionMovesPct ?? [],
    CATALYST_DRIFT_SESSION_COUNT,
  );
  const dates = raw.sessionDates ?? [];
  const sessionDates =
    dates.length >= CATALYST_DRIFT_SESSION_COUNT
      ? dates.slice(-CATALYST_DRIFT_SESSION_COUNT)
      : [...Array.from({ length: CATALYST_DRIFT_SESSION_COUNT - dates.length }, () => ""), ...dates];
  const closes = padMoves(raw.closes ?? [], CATALYST_DRIFT_SESSION_COUNT);

  const sumTail = (n: number) => moves.slice(-n).reduce((a, b) => a + b, 0);

  return {
    sessionDates,
    closes,
    sessionMovesPct: moves,
    sessionMovesRawPct: rawMoves,
    cumulative1d: raw.cumulative1d ?? sumTail(1),
    cumulative3d: raw.cumulative3d ?? sumTail(3),
    cumulative5d: raw.cumulative5d ?? sumTail(5),
    cumulative10d: raw.cumulative10d ?? raw.cumulative5d ?? sumTail(10),
    streak: raw.streak ?? 0,
    upCount: raw.upCount ?? moves.filter((m) => m > 0).length,
    downCount: raw.downCount ?? moves.filter((m) => m < 0).length,
    patternRead: raw.patternRead ?? "",
  };
}

function normalizeCard(card: CatalystCard): CatalystCard {
  return {
    ...card,
    snapshot: normalizeSnapshot(card.snapshot as LegacySnapshot),
  };
}

function feedNeedsNormalization(feed: CatalystsFeed): boolean {
  const legacy = feed as LegacyFeed;
  if (legacy.benchmarkDrift5dPct != null && legacy.benchmarkDrift10dPct == null) return true;
  const first = feed.cards?.[0];
  if (!first) return false;
  const snap = first.snapshot;
  return (
    (snap.sessionMovesPct?.length ?? 0) !== CATALYST_DRIFT_SESSION_COUNT ||
    (snap.sessionMovesRawPct?.length ?? 0) !== CATALYST_DRIFT_SESSION_COUNT
  );
}

/** Upgrades cached feeds built before the 10-session Schwab drift rebuild. */
export function normalizeCatalystsFeed(feed: CatalystsFeed): CatalystsFeed {
  if (!feedNeedsNormalization(feed)) {
    return {
      ...feed,
      benchmarkDrift10dPct: feed.benchmarkDrift10dPct ?? null,
    };
  }
  const legacy = feed as LegacyFeed;
  const benchmarkDrift10dPct =
    legacy.benchmarkDrift10dPct ?? legacy.benchmarkDrift5dPct ?? null;
  return {
    ...feed,
    benchmarkDrift10dPct,
    gateSettings: normalizeCatalystGateSettings(
      feed.gateSettings ?? DEFAULT_CATALYST_GATE_SETTINGS,
    ),
    funnel: {
      ...feed.funnel,
      filterBreakdown: feed.funnel?.filterBreakdown,
    },
    cards: (feed.cards ?? []).map(normalizeCard),
  };
}
