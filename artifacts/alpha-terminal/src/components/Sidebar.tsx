import { useState } from "react";
import { useTerminalStore } from "@/lib/store";

import { useAutoLock, TIMEOUT_OPTIONS, type SessionTimeoutMinutes } from "@/hooks/useAutoLock";
import { readSecurityPrefs, updateSecurityPref, type SecurityPrefs } from "@/lib/securityPrefs";
import { useBiometricRegistration, useWebAuthnSupported } from "@/hooks/useBiometric";
import { AuthPanel } from "./AuthPanel";
import {
  X, Shield, Settings, Link,
  Fingerprint, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useClerk } from "@clerk/clerk-react";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

function useClerkSafe() {
  if (devBypass) return { signOut: () => Promise.resolve() };
  return useClerk();
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { signOut } = useClerkSafe();
  const {
    overlays, toggleOverlay,
    aiTemp, setAiTemp,
  } = useTerminalStore();

  const { minutes: autoLock, setMinutes: setAutoLock } = useAutoLock();
  const [secPrefs, setSecPrefs] = useState<SecurityPrefs>(readSecurityPrefs);
  const { registerPasskey, loading: passkeyLoading, error: passkeyError, hasPasskey } = useBiometricRegistration();
  const webAuthnSupported = useWebAuthnSupported();

  const handleSecPrefToggle = (key: keyof SecurityPrefs, value: boolean) => {
    const updated = updateSecurityPref(key, value);
    setSecPrefs(updated);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background animate-in slide-in-from-right duration-300 flex flex-col">

      <header className="flex items-center justify-between p-6 border-b border-card-border bg-card/50">
        <div className="flex flex-col">
          <h2 className="font-black text-xl tracking-tighter text-white">COMMAND CENTER</h2>
          <span className="text-[10px] text-primary font-mono tracking-widest uppercase">System Configuration v2.0</span>
        </div>
        <button onClick={onClose} className="p-2 bg-secondary rounded-full text-primary hover:scale-110 transition-transform">
          <X className="w-6 h-6" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-32">

        <section className="space-y-4">
          <div className="flex items-center gap-2 text-primary">
            <Link className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-widest">Linked Services</h3>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-4">
            <AuthPanel />
            <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
              Connect your brokerage to enable one-tap execution and live portfolio syncing.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 text-primary">
            <Settings className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-widest">Terminal Preferences</h3>
          </div>

          <div className="space-y-4">
            <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Chart Overlays</span>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(overlays) as [keyof typeof overlays, boolean][]).map(([key, active]) => (
                  <button
                    key={key}
                    onClick={() => toggleOverlay(key)}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold border transition-all
                      ${active ? "bg-primary text-black border-primary" : "bg-secondary text-muted-foreground border-card-border"}`}
                  >
                    {key.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-xl p-4 space-y-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">AI Intelligence Params</span>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-mono">Temperature: {aiTemp.toFixed(1)}</span>
                  <span className="text-[10px] text-primary">{aiTemp > 1 ? "Creative" : "Precise"}</span>
                </div>
                <Slider value={[aiTemp]} onValueChange={(v) => setAiTemp(v[0])} max={2} step={0.1} />
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 text-primary">
            <Shield className="w-4 h-4" />
            <h3 className="text-xs font-bold uppercase tracking-widest">Security & Privacy</h3>
          </div>

          <div className="bg-card border border-card-border rounded-xl divide-y divide-card-border">
            <div className="p-4 flex flex-col gap-3">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Session Timeout</span>
              <div className="flex gap-2">
                {TIMEOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setAutoLock(opt.value as SessionTimeoutMinutes)}
                    className={`flex-1 py-2 rounded text-[10px] font-bold border transition-all
                      ${autoLock === opt.value ? "bg-primary/20 border-primary text-primary" : "bg-background border-card-border text-muted-foreground"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 space-y-4">
              {!webAuthnSupported && (
                <p className="font-mono text-[9px] text-red-400/70 leading-relaxed">
                  WebAuthn is not supported on this device.
                </p>
              )}

              {webAuthnSupported && !hasPasskey && (
                <button
                  onClick={() => void registerPasskey()}
                  disabled={passkeyLoading}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg font-mono text-[10px] font-bold tracking-wide text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-all disabled:opacity-50"
                >
                  <Fingerprint className="w-3.5 h-3.5" />
                  {passkeyLoading ? "REGISTERING..." : "REGISTER FACE ID / PASSKEY"}
                </button>
              )}

              {passkeyError && (
                <p className="font-mono text-[9px] text-red-400 leading-relaxed">{passkeyError}</p>
              )}

              {webAuthnSupported && hasPasskey && (
                <p className="font-mono text-[9px] text-green-400/70 leading-relaxed flex items-center gap-1">
                  ✓ Passkey registered
                </p>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Fingerprint className="w-5 h-5 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">App Login</span>
                    <span className="text-[10px] text-muted-foreground">Biometric authentication on launch</span>
                  </div>
                </div>
                <Switch
                  checked={secPrefs.biometricLogin}
                  onCheckedChange={(v) => handleSecPrefToggle("biometricLogin", v)}
                  disabled={!webAuthnSupported || !hasPasskey}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Fingerprint className="w-5 h-5 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Sensitive Data</span>
                    <span className="text-[10px] text-muted-foreground">Protect portfolio & account info</span>
                  </div>
                </div>
                <Switch
                  checked={secPrefs.biometricSensitiveData}
                  onCheckedChange={(v) => handleSecPrefToggle("biometricSensitiveData", v)}
                  disabled={!webAuthnSupported || !hasPasskey}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Fingerprint className="w-5 h-5 text-primary" />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold">Trade Confirmation</span>
                    <span className="text-[10px] text-muted-foreground">Require biometrics for trade execution</span>
                  </div>
                </div>
                <Switch
                  checked={secPrefs.biometricTradeConfirmation}
                  onCheckedChange={(v) => handleSecPrefToggle("biometricTradeConfirmation", v)}
                  disabled={!webAuthnSupported || !hasPasskey}
                />
              </div>
            </div>
          </div>
        </section>

        <Button
          variant="destructive"
          onClick={() => void signOut()}
          className="w-full h-12 font-black tracking-widest gap-2"
        >
          <LogOut className="w-4 h-4" /> SIGN OUT
        </Button>

      </div>
    </div>
  );
}
