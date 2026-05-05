import type { ScannerCardData } from "@/lib/unifiedScanTypes";

export type ScannerCardAction = "analyze" | "watchlist" | "mute";

export type ScannerCardProps = {
  data: ScannerCardData;
  expanded: boolean;
  onToggle: () => void;
  onAction: (action: ScannerCardAction) => void;
};

export type ScannerCardRowProps = {
  data: ScannerCardData;
  expanded: boolean;
};

export type ScannerCardDetailProps = {
  data: ScannerCardData;
  onAction: (action: ScannerCardAction) => void;
};
