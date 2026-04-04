import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeAccent = "gold" | "blue" | "green" | "orange" | "purple";
export type FontSize = "compact" | "default" | "large";
export type ChartStyle = "candles" | "bars" | "line" | "area";
export type GridDensity = "tight" | "default" | "relaxed";
export type HeaderMode = "auto" | "collapsed" | "expanded";

export const ACCENT_COLORS: Record<ThemeAccent, string> = {
  gold: "#fbbf24",
  blue: "#3b82f6",
  green: "#22c55e",
  orange: "#f97316",
  purple: "#a855f7",
};

interface UICustomizationState {
  accentColor: ThemeAccent;
  fontSize: FontSize;
  defaultChartStyle: ChartStyle;
  gridDensity: GridDensity;
  headerMode: HeaderMode;
  showTickerTape: boolean;
  showAiBiasStrip: boolean;
  showMiniCards: boolean;
  animatePriceChanges: boolean;
  hapticFeedback: boolean;
  reducedMotion: boolean;
  setAccentColor: (c: ThemeAccent) => void;
  setFontSize: (s: FontSize) => void;
  setDefaultChartStyle: (s: ChartStyle) => void;
  setGridDensity: (d: GridDensity) => void;
  setHeaderMode: (m: HeaderMode) => void;
  setShowTickerTape: (v: boolean) => void;
  setShowAiBiasStrip: (v: boolean) => void;
  setShowMiniCards: (v: boolean) => void;
  setAnimatePriceChanges: (v: boolean) => void;
  setHapticFeedback: (v: boolean) => void;
  setReducedMotion: (v: boolean) => void;
  resetDefaults: () => void;
}

const DEFAULTS = {
  accentColor: "gold" as ThemeAccent,
  fontSize: "default" as FontSize,
  defaultChartStyle: "candles" as ChartStyle,
  gridDensity: "default" as GridDensity,
  headerMode: "auto" as HeaderMode,
  showTickerTape: true,
  showAiBiasStrip: true,
  showMiniCards: true,
  animatePriceChanges: true,
  hapticFeedback: true,
  reducedMotion: false,
};

export const useUICustomizationStore = create<UICustomizationState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setAccentColor: (accentColor) => set({ accentColor }),
      setFontSize: (fontSize) => set({ fontSize }),
      setDefaultChartStyle: (defaultChartStyle) => set({ defaultChartStyle }),
      setGridDensity: (gridDensity) => set({ gridDensity }),
      setHeaderMode: (headerMode) => set({ headerMode }),
      setShowTickerTape: (showTickerTape) => set({ showTickerTape }),
      setShowAiBiasStrip: (showAiBiasStrip) => set({ showAiBiasStrip }),
      setShowMiniCards: (showMiniCards) => set({ showMiniCards }),
      setAnimatePriceChanges: (animatePriceChanges) => set({ animatePriceChanges }),
      setHapticFeedback: (hapticFeedback) => set({ hapticFeedback }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      resetDefaults: () => set(DEFAULTS),
    }),
    {
      name: "alpha-ui-customization",
      version: 3,
      migrate: (persisted: any) => ({
        ...DEFAULTS,
        ...persisted,
        headerMode: persisted?.headerMode ?? "auto",
        showAiBiasStrip: persisted?.showAiBiasStrip ?? true,
      }),
    }
  )
);
