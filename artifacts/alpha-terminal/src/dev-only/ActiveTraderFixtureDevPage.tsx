import { useLayoutEffect } from "react";
import { useLocation } from "wouter";
import TerminalPage from "@/pages/Terminal";
import { registerAtFixtureFromLocation } from "./active-trader/registerAtFixture";

function syncRegisterFromLocation() {
  registerAtFixtureFromLocation();
  try {
    sessionStorage.setItem("alpha_session_tab", "markets");
  } catch {
    /* ignore */
  }
}

/** Register once when the dev chunk loads — before the first Terminal paint. */
if (typeof window !== "undefined" && window.location.pathname.includes("/dev/active-trader")) {
  syncRegisterFromLocation();
}

export default function ActiveTraderFixtureDevPage() {
  const [location] = useLocation();

  useLayoutEffect(() => {
    syncRegisterFromLocation();
  }, [location]);

  return <TerminalPage />;
}