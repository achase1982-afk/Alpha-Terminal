import { memo } from "react";
import {
  ROW_H, STRIKE_W, BORDER_ROW, BORDER, DIM, MUTED,
  MONO, FW_LIGHT,
} from "@/components/options/optionsTheme";

const PLACEHOLDER_STRIKES = [7560, 7555, 7550, 7545, 7540, 7535, 7530, 7525, 7520, 7515, 7510];

export const AtLadderSkeleton = memo(function AtLadderSkeleton({ accentHex }: { accentHex: string }) {
  return (
    <div>
      {PLACEHOLDER_STRIKES.map((strike) => (
        <div
          key={strike}
          className="grid items-center w-full animate-pulse"
          style={{
            gridTemplateColumns: "1fr 1.1fr 44px 1.1fr 1fr",
            height: ROW_H,
            borderBottom: `1px solid ${BORDER_ROW}`,
            fontFamily: MONO,
            opacity: 0.55,
          }}
        >
          <ChatBarPlaceholder />
          <span className="text-center" style={{ fontSize: 12, color: MUTED }}>{"\u2014"}</span>
          <div
            className="flex items-center justify-center"
            style={{ width: STRIKE_W, background: accentHex, color: "black", fontSize: 12, fontWeight: FW_LIGHT }}
          >
            {strike}
          </div>
          <span className="text-center" style={{ fontSize: 12, color: MUTED }}>{"\u2014"}</span>
          <ChatBarPlaceholder />
        </div>
      ))}
    </div>
  );
});

function ChatBarPlaceholder() {
  return (
    <div className="px-2">
      <div className="h-[4px] rounded-full" style={{ background: BORDER, width: "40%" }} />
    </div>
  );
}