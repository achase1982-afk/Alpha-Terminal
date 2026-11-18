import { memo, useCallback, useRef } from "react";
import { BG_EXP_BAR, BORDER, GRAY, MONO, FW_NORMAL, GOLD } from "@/components/options/optionsTheme";
import { AT_HEADER_BG } from "@/lib/active-trader/atChromeContrast";

export type OptionsSubView = "chain" | "at";

interface OptionsSubViewToggleProps {
  view: OptionsSubView;
  onChange: (v: OptionsSubView) => void;
  /** Chain options toolbar (upper-right) vs AT glance header — same visual, shared position. */
  placement?: "chain-toolbar" | "at-header";
  accentHex?: string;
}

const SWIPE_PX = 24;
/** Match legacy dropdown box (select minWidth 72 + 0 10px padding; no chevron). */
const VIS_W_PX = 102;
const VIS_H_PX = 26;
const HIT_MIN_PX = 44;

export const OptionsSubViewToggle = memo(function OptionsSubViewToggle({
  view,
  onChange,
  placement = "chain-toolbar",
  accentHex = GOLD,
}: OptionsSubViewToggleProps) {
  const chromeBg = placement === "at-header" ? AT_HEADER_BG : BG_EXP_BAR;
  const swipeHandledRef = useRef(false);
  const startXRef = useRef(0);

  const flip = useCallback(() => {
    onChange(view === "chain" ? "at" : "chain");
  }, [view, onChange]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    swipeHandledRef.current = false;
    startXRef.current = e.clientX;
    if (typeof e.currentTarget.setPointerCapture === "function") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const dx = e.clientX - startXRef.current;
      if (Math.abs(dx) >= SWIPE_PX) {
        swipeHandledRef.current = true;
        flip();
      }
      if (typeof e.currentTarget.releasePointerCapture === "function") {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [flip],
  );

  const onClick = useCallback(() => {
    if (swipeHandledRef.current) {
      swipeHandledRef.current = false;
      return;
    }
    flip();
  }, [flip]);

  const atActive = view === "at";

  return (
    <div
      data-at-subview-chrome
      className="relative inline-flex items-center justify-center shrink-0"
      style={{ width: VIS_W_PX, height: VIS_H_PX }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={atActive}
        aria-label="Options view"
        data-at-subview-hit
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={onClick}
        className="absolute cursor-pointer border-0 p-0 m-0"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          minWidth: HIT_MIN_PX,
          minHeight: HIT_MIN_PX,
          width: Math.max(VIS_W_PX, HIT_MIN_PX),
          height: Math.max(VIS_H_PX, HIT_MIN_PX),
          background: "transparent",
          zIndex: 2,
          touchAction: "pan-y",
        }}
      />
      <div
        data-at-subview-toggle
        data-at-view-selector
        data-at-subview-value={view}
        data-at-subview-placement={placement}
        data-at-subview-visual-w={VIS_W_PX}
        data-at-subview-visual-h={VIS_H_PX}
        className="relative flex items-stretch rounded-md border overflow-hidden pointer-events-none select-none"
        style={{
          fontFamily: MONO,
          fontWeight: FW_NORMAL,
          background: chromeBg,
          borderColor: BORDER,
          width: VIS_W_PX,
          height: VIS_H_PX,
          fontSize: 11,
          color: GRAY,
          boxSizing: "border-box",
        }}
      >
        <span
          aria-hidden
          className="absolute rounded-[3px]"
          style={{
            top: 1,
            bottom: 1,
            width: "calc(50% - 1px)",
            left: 1,
            transform: atActive ? "translateX(calc(100% + 0px))" : "translateX(0)",
            transition: "transform 120ms ease-out",
            background: `${accentHex}18`,
            border: `1px solid ${accentHex}55`,
          }}
        />
        <span
          data-at-subview-segment="chain"
          className="relative z-[1] flex-1 flex items-center justify-center"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: !atActive ? accentHex : GRAY,
            lineHeight: 1,
          }}
        >
          Chain
        </span>
        <span
          data-at-subview-segment="at"
          className="relative z-[1] flex-1 flex items-center justify-center"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: atActive ? accentHex : GRAY,
            lineHeight: 1,
          }}
        >
          AT
        </span>
        <select
          aria-hidden
          tabIndex={-1}
          value={view}
          onChange={(e) => onChange(e.target.value as OptionsSubView)}
          className="sr-only"
          data-at-subview-select-fallback
        >
          <option value="chain">chain</option>
          <option value="at">at</option>
        </select>
      </div>
    </div>
  );
});