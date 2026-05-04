import type { ReactNode } from "react";
import { TabErrorBoundary } from "./TabErrorBoundary";

/** @deprecated Use TabErrorBoundary; kept for import stability in MarketScanner. */
export function ScannerErrorBoundary({ children }: { children: ReactNode }) {
  return <TabErrorBoundary tabName="Scanner">{children}</TabErrorBoundary>;
}
