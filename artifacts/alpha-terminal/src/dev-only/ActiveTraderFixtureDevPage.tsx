import { useLayoutEffect, useRef } from "react";
import TerminalPage from "@/pages/Terminal";
import { registerAtFixtureFromLocation } from "./active-trader/registerAtFixture";

export default function ActiveTraderFixtureDevPage() {
  const registered = useRef(false);
  if (!registered.current) {
    registerAtFixtureFromLocation();
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