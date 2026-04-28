import { useState, useCallback, useEffect } from "react";
import { useUser } from "@clerk/clerk-react";
import { readSecurityPrefs } from "@/lib/securityPrefs";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

/** Clerk `User` exposes passkey APIs that may not be on the public type yet. */
interface ClerkUserWithPasskeys {
  passkeys?: unknown[];
  createPasskey?: () => Promise<void>;
}

function getUserPasskeys(user: unknown): unknown[] | undefined {
  if (!user || typeof user !== "object") return undefined;
  const p = Reflect.get(user, "passkeys");
  return Array.isArray(p) ? p : undefined;
}

function userHasCreatePasskey(user: unknown): user is ClerkUserWithPasskeys {
  if (!user || typeof user !== "object") return false;
  return typeof Reflect.get(user, "createPasskey") === "function";
}

async function callUserCreatePasskey(user: ClerkUserWithPasskeys): Promise<void> {
  const fn = Reflect.get(user as object, "createPasskey");
  if (typeof fn !== "function") throw new Error("createPasskey unavailable");
  return (fn as () => Promise<void>).call(user);
}

interface ClerkApiErrorShape {
  errors?: Array<{ longMessage?: string; message?: string }>;
}

function getClerkErrors(err: unknown): ClerkApiErrorShape["errors"] | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as ClerkApiErrorShape;
  return Array.isArray(e.errors) ? e.errors : undefined;
}

export function useWebAuthnSupported(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        !!window.PublicKeyCredential &&
        typeof window.PublicKeyCredential === "function",
    );
  }, []);
  return supported;
}

function useClerkUser() {
  if (devBypass) return { user: null, isLoaded: true };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { user, isLoaded } = useUser();
  return { user: user ?? null, isLoaded };
}

export function useBiometricRegistration() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const webAuthnSupported = useWebAuthnSupported();
  const { user, isLoaded: clerkLoaded } = useClerkUser();

  useEffect(() => {
    if (!user) return;
    const passkeys = getUserPasskeys(user);
    if (Array.isArray(passkeys) && passkeys.length > 0) {
      setHasPasskey(true);
    }
  }, [user]);

  const registerPasskey = useCallback(async () => {
    if (!clerkLoaded) return;
    if (!user) {
      setError("No user session found. Please sign in first.");
      return;
    }
    if (!webAuthnSupported) {
      setError("WebAuthn/Passkeys are not supported on this device or browser.");
      return;
    }
    if (!userHasCreatePasskey(user)) {
      setError("Passkey registration is not available. Ensure Passkeys are enabled in the authentication dashboard.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await callUserCreatePasskey(user);
      setHasPasskey(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const clerkErrors = getClerkErrors(err);
      const clerkMsg = clerkErrors && clerkErrors.length > 0
        ? clerkErrors.map((e) => e.longMessage || e.message).filter(Boolean).join("; ")
        : null;

      if (msg.includes("cancelled") || msg.includes("canceled") || msg.includes("AbortError")) {
        return;
      }
      if (msg.includes("NotAllowedError")) {
        setError("Face ID / Touch ID was denied. Please allow biometric access in your device settings.");
      } else if (msg.includes("not supported") || msg.includes("SecurityError")) {
        setError("Passkeys require a secure context (HTTPS). Please use the published app URL.");
      } else if (clerkMsg) {
        setError(clerkMsg);
      } else {
        setError(msg || "Passkey registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [user, webAuthnSupported, clerkLoaded]);

  return { registerPasskey, loading, error, hasPasskey, webAuthnSupported, clerkLoaded };
}

export function useBiometricGate() {
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const webAuthnSupported = useWebAuthnSupported();

  const challenge = useCallback(async (): Promise<boolean> => {
    const prefs = readSecurityPrefs();
    if (!prefs.biometricSensitiveData || !webAuthnSupported) {
      setVerified(true);
      return true;
    }

    setLoading(true);
    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 60000,
          userVerification: "required",
          rpId: window.location.hostname,
        },
      });
      const ok = !!credential;
      setVerified(ok);
      return ok;
    } catch {
      setVerified(false);
      return false;
    } finally {
      setLoading(false);
    }
  }, [webAuthnSupported]);

  return { challenge, verified, loading };
}

export function useTradeConfirmationGate() {
  const webAuthnSupported = useWebAuthnSupported();

  const confirmTrade = useCallback(async (): Promise<boolean> => {
    const prefs = readSecurityPrefs();
    if (!prefs.biometricTradeConfirmation || !webAuthnSupported) {
      return true;
    }

    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 60000,
          userVerification: "required",
          rpId: window.location.hostname,
        },
      });
      return !!credential;
    } catch {
      return false;
    }
  }, [webAuthnSupported]);

  return { confirmTrade };
}
