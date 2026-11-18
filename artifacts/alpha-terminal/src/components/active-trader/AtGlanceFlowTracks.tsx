import { memo } from "react";
import { DOWN_TEXT, UP, WHITE } from "@/components/options/optionsTheme";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import type { DeskNetPremiumGlance, FlowTrackView } from "@/lib/active-trader/deskFlowNetPremium";

const TRACK_H = 20;

function trackColor(t: FlowTrackView): string {
  if (t.direction === "buy") return UP;
  if (t.direction === "sell") return DOWN_TEXT;
  return AT_SECONDARY;
}

function FlowTrackBar({ track, sharedScale }: { track: FlowTrackView; sharedScale: number }) {
  const color = trackColor(track);
  const towardBuy = track.netUsd >= 0;
  const fill = sharedScale > 0 ? Math.min(1, Math.abs(track.netUsd) / sharedScale) : track.barFill;
  return (
    <div className="flex items-center gap-1 min-w-0" data-at-flow-track={track.side}>
      <span
        className="shrink-0 truncate"
        style={{ width: 34, fontSize: 9, fontWeight: 600, color: AT_LABEL, letterSpacing: "0.04em" }}
      >
        {track.title}
      </span>
      <div
        className="relative flex-1 min-w-0 rounded-sm overflow-hidden"
        style={{ height: TRACK_H - 6, background: "rgba(255,255,255,0.06)" }}
        aria-hidden
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: towardBuy ? "50%" : `${50 - fill * 50}%`,
            width: `${fill * 50}%`,
            maxWidth: "50%",
            background: color,
            opacity: track.direction === "mixed" || track.direction === "quiet" ? 0.45 : 0.85,
            transition: "width 120ms linear, left 120ms linear",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(255,255,255,0.25)",
          }}
        />
      </div>
      <span className="num shrink-0 tabular-nums" style={{ fontSize: 9, fontWeight: 600, color, minWidth: 44, textAlign: "right" }}>
        {track.directionLabel === "Mixed" || track.directionLabel === "Quiet"
          ? track.directionLabel
          : track.amountLabel}
      </span>
    </div>
  );
}

export type AtGlanceFlowTracksProps = {
  glance: DeskNetPremiumGlance;
  onOpenDetail?: () => void;
};

export const AtGlanceFlowTracks = memo(function AtGlanceFlowTracks({ glance, onOpenDetail }: AtGlanceFlowTracksProps) {
  if (glance.unsupported) {
    return (
      <div data-at-flow-tracks="unsupported" style={{ fontSize: 10, color: AT_SECONDARY, lineHeight: 1.2 }}>
        Flow not available
      </div>
    );
  }
  if (glance.closed) {
    return (
      <div data-at-flow-tracks="closed" style={{ fontSize: 10, color: AT_SECONDARY }}>
        Closed
      </div>
    );
  }
  if (glance.noPrints) {
    return (
      <div data-at-flow-tracks="no-prints" className="flex items-center gap-1" style={{ fontSize: 10, color: AT_SECONDARY }}>
        <span style={{ color: WHITE }}>—</span>
        <span>no prints</span>
      </div>
    );
  }
  if (glance.stale) {
    return (
      <div data-at-flow-tracks="stale" className="flex items-center gap-1" style={{ fontSize: 10, color: AT_SECONDARY }}>
        <span style={{ color: WHITE }}>—</span>
        <span>stale</span>
      </div>
    );
  }

  if (!glance.calls || !glance.puts) return null;

  const scale = Math.max(
    Math.abs(glance.calls.netUsd),
    Math.abs(glance.puts.netUsd),
    50_000,
  );

  return (
    <button
      type="button"
      data-at-flow-tracks="live"
      data-at-flow-window={glance.windowLabel}
      className="w-full text-left"
      onClick={onOpenDetail}
      style={{ padding: 0, background: "transparent", border: "none", cursor: onOpenDetail ? "pointer" : "default" }}
      aria-label="Option flow details"
    >
      {glance.streamNote ? (
        <div data-at-flow-tape-note style={{ fontSize: 8, color: AT_LABEL, marginBottom: 2, lineHeight: 1.1 }}>
          {glance.streamNote}
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5" style={{ maxHeight: TRACK_H * 2 + 4 }}>
        <FlowTrackBar track={glance.calls} sharedScale={scale} />
        <FlowTrackBar track={glance.puts} sharedScale={scale} />
      </div>
      <div
        data-at-flow-net-label
        style={{ fontSize: 8, fontWeight: 500, color: AT_LABEL, marginTop: 2, letterSpacing: "0.04em" }}
      >
        Est. net premium · {glance.windowLabel} rolling
      </div>
    </button>
  );
});