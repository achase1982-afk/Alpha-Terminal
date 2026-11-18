import { memo } from "react";
import { GRAY, MONO } from "@/components/options/optionsTheme";
import {
  AT_LADDER_GRID,
  AT_LADDER_PANEL_BG,
  AT_LADDER_ROW_H,
  AT_LADDER_STRIKE_BG,
  AT_LADDER_STRIKE_COL_W,
  AT_LADDER_THIN_SEP,
} from "@/lib/active-trader/atLadderLayout";

/** Enough rows to cover the tallest phone; the wrapper clips them to the ladder area. */
const SKELETON_ROWS = 44;

const bar = (width: number, height: number, alpha: number) => (
  <span
    className="animate-pulse"
    style={{ width, height, borderRadius: 3, background: `rgba(255,255,255,${alpha})` }}
  />
);

/**
 * Loading state for the ladder. Same grid and row height as real rows, and it
 * fills the whole ladder area, so nothing jumps and there is no empty screen
 * while the strike window loads. It shows no strikes or prices of its own:
 * the ladder never displays numbers that did not come from its own window.
 */
export const AtLadderSkeleton = memo(function AtLadderSkeleton({
  rowHeight = AT_LADDER_ROW_H,
  message,
}: {
  rowHeight?: number;
  message?: string | null;
}) {
  return (
    <div
      data-at-ladder-skeleton
      className="relative h-full overflow-hidden"
      style={{ background: AT_LADDER_PANEL_BG }}
    >
      <div aria-hidden>
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div
            key={i}
            className="grid items-stretch w-full"
            style={{
              gridTemplateColumns: AT_LADDER_GRID,
              height: rowHeight,
              borderBottom: `1px solid ${AT_LADDER_THIN_SEP}`,
            }}
          >
            <span className="flex items-center justify-center">{bar(30, 7, 0.05)}</span>
            <span className="flex items-center justify-center">{bar(30, 7, 0.05)}</span>
            <span
              className="flex items-center justify-center"
              style={{ width: AT_LADDER_STRIKE_COL_W, background: AT_LADDER_STRIKE_BG }}
            >
              {bar(36, 9, 0.09)}
            </span>
            <span className="flex items-center justify-center">{bar(30, 7, 0.05)}</span>
            <span className="flex items-center justify-center">{bar(30, 7, 0.05)}</span>
          </div>
        ))}
      </div>
      {message ? (
        <p
          role="status"
          data-at-ladder-wait
          className="absolute left-0 right-0 text-center px-3"
          style={{ top: rowHeight * 3 + 8, fontSize: 11, color: GRAY, fontFamily: MONO }}
        >
          <span
            style={{
              display: "inline-block",
              padding: "5px 12px",
              borderRadius: 999,
              background: "rgba(10,11,14,0.92)",
              border: `1px solid ${AT_LADDER_THIN_SEP}`,
            }}
          >
            {message}
          </span>
        </p>
      ) : null}
    </div>
  );
});
