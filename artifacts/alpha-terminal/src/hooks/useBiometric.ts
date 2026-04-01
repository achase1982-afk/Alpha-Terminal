import { useState, useCallback, useEffect } from "react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { readSecurityPrefs } from "@/lib/securityPrefs";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

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

export function useBiometricRegistration() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const webAuthnSupported = useWebAuthnSupported();

  let user: ReturnType<typeof useUser>["user"] = null;
  if (!devBypass) {
    const clerkUser = useUser();
    user = clerkUser.user;
  }

  useEffect(() => {
    if (!user) return;
    const passkeys = (user as any).passkeys;
    if (Array.isArray(passkeys) && passkeys.length > 0) {
      setHasPasskey(true);
    }
  }, [user]);

  const registerPasskey = useCallback(async () => {
    if (!user) {
      setError("No user session found. Please sign in first.");
      return;
    }
    if (!webAuthnSupported) {
      setError("WebAuthn/Passkeys are not supported on this device or browser.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (typeof (user as any).createPasskey === "function") {
        await (user as any).createPasskey();
      } else {
        const response = await fetch("/api/auth/passkey-register", { method: "POST" });
        if (!response.ok) throw new Error("Passkey registration endpoint unavailable");
      }
      setHasPasskey(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancelled") || msg.includes("canceled") || msg.includes("AbortError")) {
        return;
      }
      if (msg.includes("NotAllowedError")) {
        setError("Face ID / Touch ID was denied. Please allow biometric access in your device settings.");
      } else if (msg.includes("not supported") || msg.includes("SecurityError")) {
        setError("Passkeys require a secure context (HTTPS). Please use the published app URL.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [user, webAuthnSupported]);

  return { registerPasskey, loading, error, hasPasskey, webAuthnSupported };
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
