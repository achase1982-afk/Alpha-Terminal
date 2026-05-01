import { useEffect, useRef } from "react";
import { useClerk } from "@clerk/clerk-react";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

function hasClerkRedirectParams(): boolean {
  const { search, hash } = window.location;
  return search.includes("__clerk") || hash.includes("__clerk");
}

/**
 * Completes OAuth flows that return to this SPA URL (for example, linking a provider from Settings).
 * Sign-in still uses its own hash surface; this only runs when Clerk redirect parameters are present.
 */
export function OauthReturnHandler() {
  const clerk = useClerk();
  const doneRef = useRef(false);

  useEffect(() => {
    if (devBypass) return;
    if (!hasClerkRedirectParams()) return;
    if (doneRef.current) return;
    doneRef.current = true;

    const path = window.location.pathname || "/";

    void clerk
      .handleRedirectCallback({
        signInFallbackRedirectUrl: path,
        signUpFallbackRedirectUrl: path,
      })
      .then(() => {
        window.history.replaceState({}, "", path);
      })
      .catch(() => {
        doneRef.current = false;
      });
  }, [clerk]);

  return null;
}
