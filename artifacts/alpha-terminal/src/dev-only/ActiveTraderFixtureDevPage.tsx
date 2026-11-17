import { useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";
import TerminalPage from "@/pages/Terminal";
import { registerAtFixtureFromLocation } from "./active-trader/registerAtFixture";

export default function ActiveTraderFixtureDevPage() {
  const [location] = useLocation();
  const lastSearch = useRef("");

  useLayoutEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    if (search === lastSearch.current) return;
    lastSearch.current = search;
    registerAtFixtureFromLocation();
    try {
      sessionStorage.setItem("alpha_session_tab", "markets");
    } catch {
      /* ignore */
    }
  }, [location]);

  return <TerminalPage />;
}