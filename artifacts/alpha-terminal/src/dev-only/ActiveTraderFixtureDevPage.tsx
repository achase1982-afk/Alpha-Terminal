import { useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";
import TerminalPage from "@/pages/Terminal";
import { registerAtFixtureFromLocation } from "./active-trader/registerAtFixture";

/** Must register fixture before Terminal's first paint (OptionsTab reads override in useState). */
function syncRegisterFromLocation() {
  registerAtFixtureFromLocation();
  try {
    sessionStorage.setItem("alpha_session_tab", "markets");
  } catch {
    /* ignore */
  }
}

export default function ActiveTraderFixtureDevPage() {
  const [location] = useLocation();
  const lastSearch = useRef("");

  if (typeof window !== "undefined") {
    const search = window.location.search;
    if (search !== lastSearch.current) {
      lastSearch.current = search;
      syncRegisterFromLocation();
    }
  }

  useLayoutEffect(() => {
    syncRegisterFromLocation();
  }, [location]);

  return <TerminalPage />;
}