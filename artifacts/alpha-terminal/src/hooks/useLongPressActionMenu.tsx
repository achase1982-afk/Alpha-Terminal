import { useCallback, useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;

export type LongPressMenuAction = {
  id: string;
  label: string;
  onSelect: () => void;
};

export function useLongPressActionMenu(actions: LongPressMenuAction[]) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);

  const cancelTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setAnchor(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = () => close();
    document.addEventListener("pointerdown", onDoc, true);
    return () => document.removeEventListener("pointerdown", onDoc, true);
  }, [open, close]);

  const bind = useCallback(
    (getAnchor?: (el: HTMLElement) => { x: number; y: number }) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        didLongPressRef.current = false;
        startRef.current = { x: e.clientX, y: e.clientY };
        const target = e.currentTarget;
        cancelTimer();
        timerRef.current = setTimeout(() => {
          didLongPressRef.current = true;
          const rect = target.getBoundingClientRect();
          const pos = getAnchor
            ? getAnchor(target)
            : { x: rect.left + rect.width / 2, y: rect.top };
          setAnchor(pos);
          setOpen(true);
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const start = startRef.current;
        if (!start || !timerRef.current) return;
        if (
          Math.abs(e.clientX - start.x) > MOVE_CANCEL_PX ||
          Math.abs(e.clientY - start.y) > MOVE_CANCEL_PX
        ) {
          cancelTimer();
        }
      },
      onPointerUp: () => {
        cancelTimer();
        startRef.current = null;
      },
      onPointerLeave: () => {
        cancelTimer();
        startRef.current = null;
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        didLongPressRef.current = true;
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        setAnchor({ x: e.clientX, y: e.clientY || rect.top });
        setOpen(true);
      },
    }),
    [cancelTimer],
  );

  const menu =
    open && anchor ? (
      <div
        className="fixed z-[200] min-w-[120px] rounded-md border border-card-border bg-[#1a1a1a] shadow-lg py-1"
        style={{ left: anchor.x, top: anchor.y, transform: "translate(-50%, -100%) translateY(-8px)" }}
        role="menu"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            className="block w-full text-left px-4 py-2.5 font-mono text-[14px] text-white hover:bg-white/10 touch-manipulation"
            onClick={() => {
              close();
              action.onSelect();
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null;

  return { bind, menu, close, didLongPressRef };
}
