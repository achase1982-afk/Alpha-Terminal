import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

/**
 * Schwab instrument assetType/assetMainType for the selected ticker.
 * The normal app session authenticates this read. It does not wait on the
 * browser access token that gates the quote metadata request.
 */
export function useSessionInstrumentAssetType(symbol: string): string | null {
  const requested = symbol.trim().toUpperCase();
  const [assetType, setAssetType] = useState<string | null>(null);

  useEffect(() => {
    if (!requested) {
      setAssetType(null);
      return;
    }
    let cancelled = false;
    setAssetType(null);
    void (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/market/fundamentals?symbol=${encodeURIComponent(requested)}`,
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          symbol?: string;
          assetType?: unknown;
          error?: unknown;
        };
        if (cancelled) return;
        if (typeof body.error === "string" && body.error.trim()) return;
        if ((body.symbol ?? "").trim().toUpperCase() !== requested) return;
        const raw = typeof body.assetType === "string" ? body.assetType.trim() : "";
        setAssetType(raw || null);
      } catch {
        /* leave the class unknown until verified metadata arrives */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requested]);

  return assetType;
}
