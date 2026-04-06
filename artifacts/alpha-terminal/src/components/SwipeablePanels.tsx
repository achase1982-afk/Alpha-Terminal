import { useRef, useState } from "react";

interface SwipeablePanelsProps {
  activeIndex: number;
  onChangeIndex: (idx: number) => void;
  children: React.ReactNode[];
}

const SWIPE_THRESHOLD = 40;
const VELOCITY_THRESHOLD = 0.3;
const LOCK_ANGLE_DEG = 35;

export function SwipeablePanels({ activeIndex, onChangeIndex, children }: SwipeablePanelsProps) {
  const count = children.length;
  const [dragDx, setDragDx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const lockDir = useRef<"horiz" | "vert" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const baseTranslate = (-activeIndex * 100) / count;
  const dragContrib = isDragging ? (dragDx / (containerRef.current?.clientWidth ?? window.innerWidth)) * (100 / count) : 0;
  const translatePct = baseTranslate + dragContrib;

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
    lockDir.current = null;
    setDragDx(0);
    setIsDragging(false);
  }

  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    if (!lockDir.current) {
      const angle = Math.abs(Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI));
      if (Math.hypot(dx, dy) < 6) return;
      lockDir.current = angle > LOCK_ANGLE_DEG ? "vert" : "horiz";
    }

    if (lockDir.current === "vert") return;

    e.preventDefault();
    setIsDragging(true);

    const atStart = activeIndex === 0 && dx > 0;
    const atEnd = activeIndex === count - 1 && dx < 0;
    const resistance = atStart || atEnd ? 0.25 : 1;
    setDragDx(dx * resistance);
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (lockDir.current !== "horiz") {
      setIsDragging(false);
      setDragDx(0);
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dt = (Date.now() - touchStartTime.current) || 1;
    const velocity = Math.abs(dx) / dt;
    const isFlick = velocity > VELOCITY_THRESHOLD;
    const isPast = Math.abs(dx) > SWIPE_THRESHOLD;

    setIsDragging(false);
    setDragDx(0);

    if ((isPast || isFlick) && dx < 0 && activeIndex < count - 1) {
      onChangeIndex(activeIndex + 1);
    } else if ((isPast || isFlick) && dx > 0 && activeIndex > 0) {
      onChangeIndex(activeIndex - 1);
    }
  }

  return (
    <div
      ref={containerRef}
      style={{ overflow: "hidden", flex: 1, minHeight: 0, position: "relative" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        style={{
          display: "flex",
          width: `${count * 100}%`,
          height: "100%",
          transform: `translateX(${translatePct}%)`,
          transition: isDragging ? "none" : "transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          willChange: "transform",
        }}
      >
        {children.map((child, i) => (
          <div
            key={i}
            style={{
              width: `${100 / count}%`,
              flex: `0 0 ${100 / count}%`,
              overflowY: "auto",
              overflowX: "hidden",
              height: "100%",
            }}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
