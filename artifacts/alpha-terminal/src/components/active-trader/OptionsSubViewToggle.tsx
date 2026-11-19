import { memo, useCallback, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { GRAY, MONO, FW_NORMAL, BG_EXP_BAR, WHITE } from "@/components/options/optionsTheme";
import {
  AT_HEADER_BG,
  AT_LABEL,
  AT_TOGGLE_KNOB_BOTTOM,
  AT_TOGGLE_KNOB_TOP,
  AT_TOGGLE_TRACK_BOTTOM,
  AT_TOGGLE_TRACK_TOP,
} from "@/lib/active-trader/atChromeContrast";

export type OptionsSubView = "chain" | "at";

interface OptionsSubViewToggleProps {
  view: OptionsSubView;
  onChange: (v: OptionsSubView) => void;
  placement?: "chain-toolbar" | "at-header";
}

const SWIPE_PX = 20;
/** Legacy dropdown visual footprint (no chevron). */
const PILL_W_PX = 38;
const PILL_H_PX = 22;
const CHROME_H_PX = 26;
const HIT_MIN_PX = 44;
const TRACK_INSET =
  "inset 0 2px 4px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(255,255,255,0.08)";
const KNOB_SHADOW =
  "0 1px 3px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.12)";

export const OptionsSubViewToggle = memo(function OptionsSubViewToggle({
  view,
  onChange,
  placement = "chain-toolbar",
}: OptionsSubViewToggleProps) {
  const chromeBg = placement === "at-header" ? AT_HEADER_BG : BG_EXP_BAR;
  const atActive = view === "at";
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

  if (placement === "at-header") {
    return (
      <div
        data-at-subview-chrome
        data-at-view-selector
        data-at-subview-placement={placement}
        data-at-subview-value={view}
        className="inline-flex h-[42px] shrink-0 items-center"
      >
        <button
          type="button"
          data-at-subview-hit
          aria-label="Options view"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onClick={onClick}
          className="inline-flex min-h-11 items-center gap-1 border-0 bg-transparent p-0"
          style={{
            color: WHITE,
            fontFamily: MONO,
            fontSize: 11.5,
            fontWeight: 600,
            letterSpacing: 0,
            touchAction: "pan-y",
          }}
        >
          Active Trader
          <ChevronDown aria-hidden style={{ width: 12, height: 12, color: GRAY }} />
        </button>
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
    );
  }

  return (
    <div
      data-at-subview-chrome
      data-at-view-selector
      data-at-subview-placement={placement}
      data-at-subview-value={view}
      className="relative inline-flex items-center shrink-0 gap-1.5"
      style={{
        height: CHROME_H_PX,
        background: chromeBg,
        padding: "0 2px",
        boxSizing: "border-box",
      }}
    >
      <span
        data-at-subview-label="chain"
        style={{
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 500,
          color: !atActive ? WHITE : AT_LABEL,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        Chain
      </span>
      <div
        className="relative flex items-center justify-center"
        style={{ width: PILL_W_PX, height: CHROME_H_PX }}
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
          className="absolute border-0 p-0 m-0 cursor-pointer"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            minWidth: HIT_MIN_PX,
            minHeight: HIT_MIN_PX,
            width: Math.max(PILL_W_PX, HIT_MIN_PX),
            height: Math.max(CHROME_H_PX, HIT_MIN_PX),
            background: "transparent",
            zIndex: 2,
            touchAction: "pan-y",
          }}
        />
        <div
          data-at-subview-toggle
          data-at-subview-visual-w={PILL_W_PX}
          data-at-subview-visual-h={PILL_H_PX}
          className="relative rounded-full pointer-events-none"
          style={{
            width: PILL_W_PX,
            height: PILL_H_PX,
            background: `linear-gradient(180deg, ${AT_TOGGLE_TRACK_TOP} 0%, ${AT_TOGGLE_TRACK_BOTTOM} 100%)`,
            boxShadow: TRACK_INSET,
          }}
        >
          <span
            aria-hidden
            className="absolute rounded-full"
            style={{
              width: PILL_H_PX - 4,
              height: PILL_H_PX - 4,
              top: 2,
              left: atActive ? PILL_W_PX - (PILL_H_PX - 2) : 2,
              background: `linear-gradient(180deg, ${AT_TOGGLE_KNOB_TOP} 0%, ${AT_TOGGLE_KNOB_BOTTOM} 100%)`,
              boxShadow: KNOB_SHADOW,
              transition: "left 160ms cubic-bezier(0.33, 1, 0.68, 1)",
            }}
          />
        </div>
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
      <span
        data-at-subview-label="at"
        style={{
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: FW_NORMAL,
          color: atActive ? WHITE : AT_LABEL,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        ActiveTrader
      </span>
    </div>
  );
});