import { useEffect } from "react";
import { useMarketStream } from "@/hooks/useMarketStream";
import GlancePage from "./GlancePage";

const GLANCE_SYMBOLS = ["$SPX", "$VIX", "SPY", "QQQ", "IWM"];

/** Standalone /ipad and /glance owner for the shared quote stream. */
export default function GlanceRoute() {
  const { subscribeEquitySymbols } = useMarketStream();
  useEffect(() => {
    void subscribeEquitySymbols(GLANCE_SYMBOLS);
  }, [subscribeEquitySymbols]);
  return <GlancePage />;
}
