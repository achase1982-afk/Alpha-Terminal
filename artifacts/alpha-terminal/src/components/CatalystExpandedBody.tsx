import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import type { CatalystCard } from "@workspace/catalysts-types";
import type { QuoteData } from "@/hooks/useQuote";
import { buildSettledSessionRowsNewestFirst } from "@/lib/catalystSessionDisplay";
import {
  fmtPct,
  liveSpotPrice,
  liveTapeMode,
  liveTodayTapeLabel,
  liveVsSpyDayPct,
  pctColor,
  priorSettledClose,
  type LiveTapeMode,
} from "@/lib/catalystsSession";

const TEXT_PRIMARY = "#fafafa";
const BORDER_HAIRLINE = "#3A3A3A";
const ELEVATED = "#1a1a1a";
const ROW_BAND = "rgba(255, 255, 255, 0.03)";
const GREEN = "#00d166";
const RED = "#f23645";
const GOLD = "#FFB800";
const MIN_FONT_PX = 12;
const KEY_PRICE_PX = 17;
const VS_LEAD_PX = 15;
const SECTION_GAP_PX = 16;
const TICK_FLASH_MS = 300;
const BODY_LINE_HEIGHT = 1.55;

const sectionLabelStyle: CSSProperties = {
  fontSize: MIN_FONT_PX,
  fontWeight: 700,
  color: TEXT_PRIMARY,
  opacity: 0.55,
  marginBottom: 8,
  lineHeight: BODY_LINE_HEIGHT,
};

const dimRefStyle: CSSProperties = {
  fontSize: MIN_FONT_PX,
  color: TEXT_PRIMARY,
  opacity: 0.55,
  fontWeight: 400,
};

function directionPriceColor(movePct: number | null): string {
  if (movePct == null || !Number.isFinite(movePct) || movePct === 0) return TEXT_PRIMARY;
  return movePct > 0 ? GREEN : RED;
}

/** Quote-style live price: green/red by session move, brief flash on each tick. */
function useLivePriceColor(liveSpot: number | null, movePct: number | null): string {
  const base = directionPriceColor(movePct);
  const prev = useRef<number | null>(null);
  const [color, setColor] = useState(base);

  useEffect(() => {
    setColor(base);
  }, [base]);

  useEffect(() => {
    if (liveSpot == null) {
      prev.current = liveSpot;
      return undefined;
    }
    if (prev.current != null && liveSpot !== prev.current) {
      setColor(liveSpot > prev.current ? GREEN : RED);
      const t = setTimeout(() => setColor(base), TICK_FLASH_MS);
      prev.current = liveSpot;
      return () => clearTimeout(t);
    }
    prev.current = liveSpot;
    return undefined;
  }, [liveSpot, base]);

  return color;
}

function LiveSpotStrip({
  liveLabel,
  liveSpot,
  priorClose,
  liveMoves,
  spyHistoryOk,
}: {
  liveLabel: string;
  liveSpot: number | null;
  priorClose: number | null;
  liveMoves: { raw: number | null; spy: number | null; vs: number | null };
  spyHistoryOk: boolean;
}) {
  const movePct = spyHistoryOk ? liveMoves.vs : liveMoves.raw;
  const spotColor = useLivePriceColor(liveSpot, movePct);

  return (
    <div className="flex items-center justify-between gap-3 font-mono py-1">
      <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
        <span style={{ fontSize: MIN_FONT_PX, fontWeight: 700, color: TEXT_PRIMARY, opacity: 0.55 }}>
          {liveLabel} · LIVE
        </span>
        {liveSpot != null ? (
          <>
            <span
              className="tabular-nums font-bold"
              style={{ fontSize: KEY_PRICE_PX, color: spotColor, transition: "color 0.15s ease" }}
            >
              ${liveSpot.toFixed(2)}
            </span>
            <span
              className="tabular-nums font-bold"
              style={{ fontSize: MIN_FONT_PX, color: pctColor(movePct) }}
            >
              {fmtPct(movePct)}
            </span>
          </>
        ) : (
          <span style={{ fontSize: MIN_FONT_PX, color: TEXT_PRIMARY, opacity: 0.55 }}>
            Awaiting live quote…
          </span>
        )}
      </div>
      {priorClose != null ? (
        <span className="tabular-nums shrink-0 text-right" style={dimRefStyle}>
          Prior close ${priorClose.toFixed(2)}
        </span>
      ) : null}
    </div>
  );
}

function CumulativeDriftSection({ card }: { card: CatalystCard }) {
  const chips: { label: string; val: number }[] = [
    { label: "T-1", val: card.snapshot.cumulative1d },
    { label: "T-3", val: card.snapshot.cumulative3d },
    { label: "T-5", val: card.snapshot.cumulative5d },
    { label: "T-10", val: card.snapshot.cumulative10d },
  ];

  return (
    <section>
      <div className="grid grid-cols-4 gap-2">
        {chips.map(({ label, val }) => (
          <div
            key={label}
            className="font-mono text-center py-1.5 px-1"
            style={{
              border: `1px solid ${BORDER_HAIRLINE}`,
              borderRadius: 6,
              background: ELEVATED,
            }}
          >
            <div style={{ fontSize: MIN_FONT_PX, color: TEXT_PRIMARY, opacity: 0.55, fontWeight: 700 }}>
              {label}
            </div>
            <div
              className="tabular-nums font-bold mt-0.5"
              style={{ fontSize: MIN_FONT_PX, color: pctColor(val) }}
            >
              {fmtPct(val)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettledSessionsSection({
  card,
  spyHistoryOk,
}: {
  card: CatalystCard;
  spyHistoryOk: boolean;
}) {
  const rows = buildSettledSessionRowsNewestFirst(card, spyHistoryOk);
  const suspect = card.snapshot.sessionSuspect ?? [];

  return (
    <section>
      <p style={sectionLabelStyle}>Settled · T-1 … T-10</p>
      <div
        className="font-mono overflow-hidden"
        style={{ border: `1px solid ${BORDER_HAIRLINE}`, borderRadius: 6 }}
      >
        {rows.map((row, idx) => {
          const sessionIndex = card.snapshot.sessionDates.length - 1 - idx;
          const isSuspect = suspect[sessionIndex] === true;
          return (
            <div
              key={`${row.dateYmd}-${row.label}`}
              className="flex items-center justify-between gap-2 px-2.5 py-1.5"
              style={{
                background: idx % 2 === 1 ? ROW_BAND : "transparent",
                fontSize: MIN_FONT_PX,
              }}
            >
              <span style={{ fontWeight: 700, color: TEXT_PRIMARY, opacity: isSuspect ? 0.55 : 1 }}>
                {row.label}
                {isSuspect ? " · suspect" : ""}
              </span>
              <div className="flex items-baseline gap-2 min-w-0 justify-end flex-wrap">
                <span
                  className="tabular-nums font-bold shrink-0"
                  style={{ fontSize: VS_LEAD_PX, color: pctColor(row.vsSpyPct) }}
                >
                  {fmtPct(row.vsSpyPct)}
                </span>
                <span className="tabular-nums shrink-0" style={dimRefStyle}>
                  raw {fmtPct(row.rawPct)}
                  {spyHistoryOk ? ` · S&P ${fmtPct(row.spyPct)}` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export const CatalystExpandedBody = memo(function CatalystExpandedBody({
  card,
  spyHistoryOk,
  stockQuote,
  spyQuote,
  onNavigate,
  onSendToStrategist,
  strategistSent,
  onStrategistClick,
}: {
  card: CatalystCard;
  spyHistoryOk: boolean;
  stockQuote: QuoteData | null;
  spyQuote: QuoteData | null;
  onNavigate?: (sym: string) => void;
  onSendToStrategist?: (sym: string, flowContext: string) => void;
  strategistSent: boolean;
  onStrategistClick: () => void;
}) {
  const tapeMode: LiveTapeMode = liveTapeMode();
  const priorClose = priorSettledClose(card);
  const liveSpot = liveSpotPrice(stockQuote, tapeMode);
  const liveMoves = liveVsSpyDayPct(stockQuote, spyQuote, priorClose, tapeMode);
  const liveLabel = liveTodayTapeLabel(tapeMode);

  return (
    <div
      className="font-mono flex flex-col"
      style={{
        paddingLeft: 36,
        paddingRight: 12,
        paddingTop: 4,
        paddingBottom: 8,
        gap: SECTION_GAP_PX,
      }}
    >
      <LiveSpotStrip
        liveLabel={liveLabel}
        liveSpot={liveSpot}
        priorClose={priorClose}
        liveMoves={liveMoves}
        spyHistoryOk={spyHistoryOk}
      />

      <p style={{ color: TEXT_PRIMARY, fontSize: MIN_FONT_PX, lineHeight: BODY_LINE_HEIGHT, margin: 0 }}>
        {card.snapshot.patternRead}
      </p>

      <CumulativeDriftSection card={card} />

      <SettledSessionsSection card={card} spyHistoryOk={spyHistoryOk} />

      <div
        className="flex flex-wrap items-center justify-between gap-3"
        style={{ fontSize: MIN_FONT_PX, color: TEXT_PRIMARY }}
      >
        <span>
          IMPLIED{" "}
          {card.impliedMovePct != null && Number.isFinite(card.impliedMovePct) ? (
            <span style={{ color: GOLD, fontWeight: 700 }}>±{card.impliedMovePct.toFixed(1)}%</span>
          ) : (
            "—"
          )}
        </span>
        <span style={{ opacity: 0.55 }}>
          STREAK {card.snapshot.streak}
          {!card.earningsConfirmed ? " · EST." : ""}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 font-bold tracking-wider">
        {onNavigate ? (
          <button
            type="button"
            className="shrink-0"
            style={{ color: GOLD, fontSize: MIN_FONT_PX }}
            onClick={() => onNavigate(card.symbol)}
          >
            Open {card.symbol} →
          </button>
        ) : (
          <span />
        )}
        {onSendToStrategist ? (
          <button
            type="button"
            className="shrink-0 ml-auto"
            style={{ color: GOLD, fontSize: MIN_FONT_PX }}
            onClick={onStrategistClick}
          >
            {strategistSent ? "Sent to Strategist" : "Send to Strategist"}
          </button>
        ) : null}
      </div>
    </div>
  );
});
