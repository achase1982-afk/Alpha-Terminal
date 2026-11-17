import { useLayoutEffect, useRef } from "react";
import TerminalPage from "@/pages/Terminal";
import { registerChainOrderFixtureFromLocation } from "./chain-order/registerChainOrderFixture";

export default function ChainOrderFixtureDevPage() {
  const registered = useRef(false);
  if (!registered.current) {
    registerChainOrderFixtureFromLocation();
    registered.current = true;
  }

  useLayoutEffect(() => {
    try {
      sessionStorage.setItem("alpha_session_tab", "markets");
    } catch {
      /* ignore */
    }
  }, []);

  return <TerminalPage />;
}