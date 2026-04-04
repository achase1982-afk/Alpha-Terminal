import { useEffect } from "react";
import { useUICustomizationStore, ACCENT_COLORS, type ThemeAccent, type FontSize, type GridDensity } from "@/lib/ui-customization-store";

const ACCENT_HSL: Record<ThemeAccent, string> = {
  gold: "43 96% 56%",
  blue: "217 91% 60%",
  green: "142 71% 45%",
  orange: "25 95% 53%",
  purple: "271 91% 65%",
};

const FONT_SCALE: Record<FontSize, number> = {
  compact: 0.9,
  default: 1,
  large: 1.1,
};

const GRID_PADDING: Record<GridDensity, string> = {
  tight: "2px",
  default: "4px",
  relaxed: "8px",
};

export function useUIThemeSync() {
  const accentColor = useUICustomizationStore((s) => s.accentColor);
  const fontSize = useUICustomizationStore((s) => s.fontSize);
  const gridDensity = useUICustomizationStore((s) => s.gridDensity);
  const reducedMotion = useUICustomizationStore((s) => s.reducedMotion);

  useEffect(() => {
    const root = document.documentElement;

    const hsl = ACCENT_HSL[accentColor];
    root.style.setProperty("--primary", hsl);
    root.style.setProperty("--accent", hsl);

    const scale = FONT_SCALE[fontSize];
    root.style.setProperty("--ui-font-scale", String(scale));
    root.style.fontSize = `${scale * 16}px`;

    root.style.setProperty("--ui-grid-pad", GRID_PADDING[gridDensity]);

    if (reducedMotion) {
      root.classList.add("ui-reduced-motion");
    } else {
      root.classList.remove("ui-reduced-motion");
    }

    return () => {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--accent");
      root.style.removeProperty("--ui-font-scale");
      root.style.removeProperty("--ui-grid-pad");
      root.style.fontSize = "";
      root.classList.remove("ui-reduced-motion");
    };
  }, [accentColor, fontSize, gridDensity, reducedMotion]);
}
