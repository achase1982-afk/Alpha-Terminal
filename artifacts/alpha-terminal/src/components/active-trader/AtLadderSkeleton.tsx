import { memo } from "react";
import {
  STRIKE_W, BORDER_ROW, BORDER, MUTED,
  MONO, FW_LIGHT,
} from "@/components/options/optionsTheme";
import { AT_LADDER_GRID, AT_LADDER_ROW_H } from "@/lib/active-trader/atLadderLayout";
import { atLadderSkeletonStrikes } from "@/lib/active-trader/atLadderSkeletonStrikes";

export const AtLadderSkeleton = memo(function AtLadderSkeleton({
  accentHex,
  underlyingPrice,
}: {
  accentHex: string;
  underlyingPrice: number | null;
}) {
  const strikes = atLadderSkeletonStrikes(underlyingPrice);
  return (
    <div data-at-ladder-skeleton aria-hidden>
      {strikes.map((strike) => (
        <div
          key={strike}
          className="grid items-center w-full animate-pulse"
          style={{
            gridTemplateColumns: AT_LADDER_GRID,
            height: AT_LADDER_ROW_H,
            borderBottom: `1px solid ${BORDER_ROW}`,
            fontFamily: MONO,
            opacity: 0.55,
          }}
        >
          <span className="text-right pr-1" style={{ fontSize: 12, color: MUTED }}>
            {"\u2014"}
          </span>
          <span className="text-right pr-1" style={{ fontSize: 12, color: MUTED }}>
            {"\u2014"}
          </span>
          <div
            className="flex items-center justify-center"
            style={{ width: STRIKE_W, background: accentHex, color: "black", fontSize: 12, fontWeight: FW_LIGHT }}
          >
            {strike}
          </div>
          <span className="text-right pr-1" style={{ fontSize: 12, color: MUTED }}>
            {"\u2014"}
          </span>
          <span className="text-right pr-1" style={{ fontSize: 12, color: MUTED }}>
            {"\u2014"}
          </span>
        </div>
      ))}
    </div>
  );
});