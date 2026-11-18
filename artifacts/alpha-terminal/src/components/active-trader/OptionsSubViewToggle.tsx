import { memo, useCallback, useRef } from "react";
import { GRAY, MONO, FW_NORMAL, GOLD } from "@/components/options/optionsTheme";

export type OptionsSubView = "chain" | "at";

interface OptionsSubViewToggleProps {
  view: OptionsSubView;
  onChange: (v: OptionsSubView) => void;
  /** Chain options toolbar (upper-right) vs AT glance header — same visual, shared position. */
  placement?: "chain-toolbar" | "at-header";
  /** Active Trader accent (gold default). */
  accentHex?: string;
}

const MIN_TAP = 44;
const SWIPE_PX = 28;
/** Slim iOS track height inside the 44px tap target (matches prior dropdown vertical slot). */
const TRACK_H_PX = 30;
/** Fixed width keeps Chain ↔ AT switch from shifting header layout (440px WebKit). */
const TRACK_W_PX = 112;
const TRACK_INSET_PX = 2;
const PILL_ON_LABEL = "#0a0a0a";

export const OptionsSubViewToggle = memo(function OptionsSubViewToggle({
  view,
  onChange,
  placement = "chain-toolbar",
  accentHex = GOLD,
}: OptionsSubViewToggleProps) {
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
      className="inline-flex items-center justify-center shrink-0"
      style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={atActive}
        aria-label="Options view"
        data-at-subview-toggle
        data-at-view-selector
        data-at-subview-value={view}
        data-at-subview-placement={placement}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={onClick}
        className="relative inline-flex items-stretch rounded-full cursor-pointer select-none overflow-hidden"
        style={{
          fontFamily: MONO,
          fontWeight: FW_NORMAL,
          background: "#000000",
          border: "none",
          height: TRACK_H_PX,
          minHeight: TRACK_H_PX,
          minWidth: MIN_TAP,
          width: TRACK_W_PX,
          padding: TRACK_INSET_PX,
          boxSizing: "border-box",
          touchAction: "pan-y",
          boxShadow: "none",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            top: TRACK_INSET_PX,
            bottom: TRACK_INSET_PX,
            width: `calc(50% - ${TRACK_INSET_PX}px)`,
            left: TRACK_INSET_PX,
            transform: atActive ? "translateX(calc(100%))" : "translateX(0)",
            transition: "transform 180ms cubic-bezier(0.33, 1, 0.68, 1)",
            background: accentHex,
            border: "none",
            boxShadow: "none",
          }}
        />
        <span
          data-at-subview-segment="chain"
          className="relative z-[1] flex-1 flex items-center justify-center pointer-events-none"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: !atActive ? PILL_ON_LABEL : GRAY,
            minHeight: TRACK_H_PX - TRACK_INSET_PX * 2,
            letterSpacing: "0.02em",
            transition: "color 180ms ease-out",
          }}
        >
          Chain
        </span>
        <span
          data-at-subview-segment="at"
          className="relative z-[1] flex-1 flex items-center justify-center pointer-events-none"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: atActive ? PILL_ON_LABEL : GRAY,
            minHeight: TRACK_H_PX - TRACK_INSET_PX * 2,
            letterSpacing: "0.02em",
            transition: "color 180ms ease-out",
          }}
        >
          AT
        </span>
        {/* Playwright / legacy: selectOption still works; visually hidden (no dropdown arrow). */}
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
      </button>
    </div>
  );
});