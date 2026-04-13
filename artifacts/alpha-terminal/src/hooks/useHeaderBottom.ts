import { useState, useEffect } from "react";

export function useHeaderBottom(): number {
  const [bottom, setBottom] = useState(0);

  useEffect(() => {
    const el = document.getElementById("terminal-header");
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBottom(rect.bottom);
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return bottom;
}
