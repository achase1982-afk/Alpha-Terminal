import { memo, useCallback, useRef } from "react";
import { BORDER, GRAY, MONO, FW_NORMAL, GOLD } from "@/components/options/optionsTheme";

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
/** Fixed width keeps Chain ↔ AT switch from shifting header layout (440px WebKit). */
const TRACK_W_PX = 136;

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
        className="relative inline-flex items-stretch rounded-md border cursor-pointer select-none overflow-hidden"
        style={{
          fontFamily: MONO,
          fontWeight: FW_NORMAL,
          background: "#000000",
          borderColor: BORDER,
          minHeight: MIN_TAP,
          minWidth: MIN_TAP,
          width: TRACK_W_PX,
          padding: 2,
          boxSizing: "border-box",
          touchAction: "pan-y",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute rounded-[5px]"
          style={{
            top: 2,
            bottom: 2,
            width: "calc(50% - 2px)",
            left: 2,
            transform: atActive ? "translateX(calc(100% + 0px))" : "translateX(0)",
            transition: "transform 150ms ease-out",
            background: `${accentHex}1f`,
            border: `1px solid ${accentHex}66`,
            boxShadow: atActive ? `0 0 10px ${accentHex}22` : "none",
          }}
        />
        <span
          data-at-subview-segment="chain"
          className="relative z-[1] flex-1 flex items-center justify-center pointer-events-none"
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: !atActive ? accentHex : GRAY,
            minHeight: MIN_TAP - 4,
            letterSpacing: "0.02em",
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
            color: atActive ? accentHex : GRAY,
            minHeight: MIN_TAP - 4,
            letterSpacing: "0.02em",
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