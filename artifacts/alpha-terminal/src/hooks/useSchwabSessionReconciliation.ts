import { useEffect, useRef, type RefObject } from "react";
import { clearSchwabAuthNotice } from "@/lib/authNoticeStore";
import {
  usePortfolioStreamStore,
  type PortfolioStatus,
} from "@/lib/portfolio-stream-store";
import type { SidebarHandle } from "@/components/Sidebar";

/** Server portfolio stream reports a valid Schwab trader session. */
export function isPortfolioSchwabSessionHealthy(
  status: PortfolioStatus,
): boolean {
  return status.status === "ok";
}

/** Session lost or portfolio poll failed — not healthy. */
export function isPortfolioSchwabSessionUnhealthy(
  status: PortfolioStatus,
): boolean {
  return status.status === "no_token" || status.status === "error";
}

/**
 * Reconcile Schwab auth UI against WS portfolioStatus (server ground truth).
 * - While healthy (`status === "ok"`): clear stale Schwab session banner.
 * - On unhealthy → healthy transition: dismiss Linked Brokerage overlay if open.
 */
export function useSchwabSessionReconciliation(
  sidebarRef: RefObject<SidebarHandle | null>,
) {
  const portfolioStatus = usePortfolioStreamStore((s) => s.portfolioStatus);
  const prevStatusRef = useRef<PortfolioStatus | null>(null);

  useEffect(() => {
    const prev = prevStatusRef.current;
    const curr = portfolioStatus;

    if (isPortfolioSchwabSessionHealthy(curr)) {
      clearSchwabAuthNotice();
    }

    if (
      prev !== null &&
      isPortfolioSchwabSessionUnhealthy(prev) &&
      isPortfolioSchwabSessionHealthy(curr)
    ) {
      const page = sidebarRef.current?.getActivePage?.() ?? null;
      if (page === "Linked Brokerage") {
        sidebarRef.current?.clearActivePage();
      }
    }

    prevStatusRef.current = curr;
  }, [portfolioStatus, sidebarRef]);
}
