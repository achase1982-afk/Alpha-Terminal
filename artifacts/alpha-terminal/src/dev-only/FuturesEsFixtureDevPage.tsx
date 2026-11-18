import { useLayoutEffect, useRef } from "react";
import TerminalPage from "@/pages/Terminal";
import { registerFuturesEsFixtureFromLocation } from "./futures-es/registerFuturesEsFixture";

export default function FuturesEsFixtureDevPage() {
  const registered = useRef(false);
  if (!registered.current) {
    registerFuturesEsFixtureFromLocation();
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