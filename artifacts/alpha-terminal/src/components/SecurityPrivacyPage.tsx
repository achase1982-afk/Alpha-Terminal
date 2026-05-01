import React, { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  useClerk,
  useSession,
  useSessionList,
  useUser,
  isClerkAPIResponseError,
} from "@clerk/clerk-react";
import { Loader2, Copy, Download, AlertCircle } from "lucide-react";
import { useAutoLock, TIMEOUT_OPTIONS, type SessionTimeoutMinutes } from "@/hooks/useAutoLock";
import { useWebAuthnSupported } from "@/hooks/useBiometric";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

type ClerkUser = NonNullable<Extract<ReturnType<typeof useUser>, { isLoaded: true; isSignedIn: true }>["user"]>;
type SessionWithActivities = Awaited<ReturnType<ClerkUser["getSessions"]>>[number];
type ExternalAccount = ClerkUser["externalAccounts"][number];
type EmailAddress = ClerkUser["emailAddresses"][number];
type Passkey = NonNullable<ClerkUser["passkeys"]>[number];

const CARD =
  "rounded-lg border border-[#2a2a2c] bg-[#1a1a1c] p-4 space-y-3 focus-within:ring-1 focus-within:ring-primary/60";
const BTN_SEG =
  "px-3 py-2 rounded text-xs font-bold border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]";
const BTN_SEG_ON = `${BTN_SEG} bg-primary text-black border-primary`;
const BTN_SEG_OFF = `${BTN_SEG} bg-card text-muted-foreground border-card-border hover:border-primary/30`;

function formatWhen(d: Date | null | undefined): string {
  if (!d) return "Unknown";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return String(d);
  }
}

function clerkErrorMessage(err: unknown): string {
  if (isClerkAPIResponseError(err)) {
    const parts = err.errors?.map((e) => e.longMessage || e.message).filter(Boolean);
    if (parts?.length) return parts.join("; ");
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}

function getAuthenticatableOAuthStrategies(clerk: ReturnType<typeof useClerk>): string[] {
  const c = clerk as unknown as {
    environment?: { userSettings?: { authenticatableSocialStrategies?: string[] } };
    __unstable_environment?: { userSettings?: { authenticatableSocialStrategies?: string[] } };
  };
  const list =
    c.environment?.userSettings?.authenticatableSocialStrategies ??
    c.__unstable_environment?.userSettings?.authenticatableSocialStrategies ??
    [];
  return list.filter((s): s is string => typeof s === "string" && s.startsWith("oauth_"));
}

function strategyLabel(strategy: string): string {
  const slug = strategy.replace(/^oauth_/, "");
  return slug.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
}

async function copyText(label: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: `${label} copied to clipboard.` });
  } catch {
    toast({
      title: "Copy failed",
      description: "Your browser blocked clipboard access.",
      variant: "destructive",
    });
  }
}

function LiveStatus({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}

function SecurityCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      <div>
        <h3 className="text-xs font-bold text-primary uppercase tracking-widest font-mono">{title}</h3>
        {description ? (
          <p className="mt-1 font-mono text-[10px] text-zinc-500 leading-relaxed">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function PasswordCard({ user }: { user: ClerkUser }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  if (!user.passwordEnabled) {
    return (
      <SecurityCard
        title="Password"
        description="Your account does not use a Clerk password (for example, email code only)."
      >
        <p className="font-mono text-[11px] text-zinc-400">Password changes are unavailable for this account type.</p>
      </SecurityCard>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (next.length < 8) {
      setErr("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setErr("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      await user.updatePassword({
        currentPassword: current,
        newPassword: next,
        signOutOfOtherSessions: true,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      await user.reload();
      toast({ title: "Password updated", description: "Other sessions were signed out." });
      setAnnounce("Password updated successfully.");
    } catch (e) {
      const msg = clerkErrorMessage(e);
      setErr(msg);
      toast({ title: "Password update failed", description: msg, variant: "destructive" });
      setAnnounce(`Password update failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SecurityCard
      title="Password"
      description="Changing your password signs out other sessions for safety."
    >
      <LiveStatus message={announce} />
      <p className="font-mono text-[10px] text-zinc-500">
        Account last updated: <span className="text-zinc-300">{formatWhen(user.updatedAt)}</span>
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="sec-cur-pw" className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Current password
          </Label>
          <Input
            id="sec-cur-pw"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="font-mono text-xs h-9 bg-background border-[#2a2a2c] focus-visible:ring-2 focus-visible:ring-primary"
            aria-invalid={!!err}
            aria-describedby={err ? "sec-pw-err" : undefined}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sec-new-pw" className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            New password
          </Label>
          <Input
            id="sec-new-pw"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="font-mono text-xs h-9 bg-background border-[#2a2a2c] focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sec-conf-pw" className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
            Confirm new password
          </Label>
          <Input
            id="sec-conf-pw"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="font-mono text-xs h-9 bg-background border-[#2a2a2c] focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        {err ? (
          <p id="sec-pw-err" className="text-xs text-destructive flex items-start gap-1.5" role="alert">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
            {err}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={busy || !current || !next}
          className="font-mono text-xs h-9"
          aria-busy={busy}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : null}
          Update password
        </Button>
      </form>
    </SecurityCard>
  );
}

function MfaCard({ user }: { user: ClerkUser }) {
  const [totpSetup, setTotpSetup] = useState<Awaited<ReturnType<ClerkUser["createTOTP"]>> | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [backupRegenOpen, setBackupRegenOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!totpSetup?.uri) {
      setQrDataUrl(null);
      return;
    }
    void QRCode.toDataURL(totpSetup.uri, { margin: 1, width: 180, color: { dark: "#000000", light: "#ffffff" } }).then(
      (url) => {
        if (!cancelled) setQrDataUrl(url);
      },
      () => {
        if (!cancelled) setQrDataUrl(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [totpSetup?.uri]);

  const startTotp = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await user.createTOTP();
      setTotpSetup(res);
      setTotpCode("");
      toast({ title: "Authenticator setup started", description: "Scan the QR code or copy the secret, then enter a code." });
      setAnnounce("Authenticator setup started.");
    } catch (e) {
      const msg = clerkErrorMessage(e);
      setErr(msg);
      toast({ title: "Could not start authenticator setup", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const verifyTotp = async () => {
    setErr(null);
    setBusy(true);
    try {
      await user.verifyTOTP({ code: totpCode.trim() });
      setTotpSetup(null);
      setTotpCode("");
      await user.reload();
      toast({ title: "Authenticator enabled", description: "TOTP is now active on your account." });
      setAnnounce("Authenticator enabled.");
    } catch (e) {
      const msg = clerkErrorMessage(e);
      setErr(msg);
      toast({ title: "Verification failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const disableTotp = async () => {
    setErr(null);
    setBusy(true);
    try {
      await user.disableTOTP();
      setDisableOpen(false);
      await user.reload();
      toast({ title: "Authenticator disabled", description: "TOTP was removed from your account." });
      setAnnounce("Authenticator disabled.");
    } catch (e) {
      const msg = clerkErrorMessage(e);
      toast({ title: "Could not disable authenticator", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const generateBackupCodes = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await user.createBackupCode();
      setBackupCodes(res.codes ?? []);
      setBackupRegenOpen(false);
      await user.reload();
      toast({ title: "New backup codes generated", description: "Store them somewhere safe. Old codes no longer work." });
      setAnnounce("New backup codes generated.");
    } catch (e) {
      const msg = clerkErrorMessage(e);
      toast({ title: "Backup codes failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const mfaOn = user.twoFactorEnabled;
  const methods: string[] = [];
  if (user.totpEnabled) methods.push("Authenticator app (TOTP)");
  if (user.backupCodeEnabled) methods.push("Backup codes");

  return (
    <SecurityCard
      title="Multi-factor authentication"
      description="Email-only scope: TOTP and backup codes. SMS and phone MFA are not offered here."
    >
      <LiveStatus message={announce} />
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold font-mono uppercase border ${
            mfaOn ? "border-emerald-600/60 text-emerald-400 bg-emerald-950/40" : "border-zinc-600 text-zinc-400 bg-zinc-900/50"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {mfaOn ? "MFA on" : "MFA off"}
        </span>
        {methods.length ? (
          <span className="text-[10px] text-zinc-500 font-mono">Active: {methods.join(", ")}</span>
        ) : (
          <span className="text-[10px] text-zinc-500 font-mono">No second factors active</span>
        )}
      </div>
      {user.backupCodeEnabled ? (
        <p className="font-mono text-[10px] text-zinc-500">
          Backup codes: enabled. Clerk does not expose a remaining-count on the client. Generate a fresh set if you are
          running low.
        </p>
      ) : null}

      {err ? (
        <p className="text-xs text-destructive flex items-start gap-1.5" role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
          {err}
        </p>
      ) : null}

      <div className="space-y-2 border-t border-[#2a2a2c] pt-3">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Authenticator app (TOTP)</p>
        {user.totpEnabled ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="font-mono text-xs" onClick={() => setDisableOpen(true)}>
              Disable TOTP
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {!totpSetup ? (
              <Button type="button" size="sm" className="font-mono text-xs" onClick={startTotp} disabled={busy} aria-busy={busy}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Set up authenticator
              </Button>
            ) : (
              <div className="space-y-3">
                {qrDataUrl ? (
                  <div className="flex gap-3 items-start flex-wrap">
                    <img src={qrDataUrl} alt="QR code for authenticator setup" className="rounded border border-zinc-700 bg-white p-1" />
                    <div className="space-y-1 min-w-0 flex-1">
                      <span className="font-mono text-[9px] text-zinc-500 uppercase">Secret</span>
                      <div className="flex gap-2 flex-wrap">
                        <code className="font-mono text-[10px] break-all text-zinc-300 bg-black/40 px-2 py-1 rounded border border-zinc-800">
                          {totpSetup.secret}
                        </code>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="font-mono text-xs shrink-0"
                          onClick={() => void copyText("TOTP secret", totpSetup.secret ?? "")}
                          disabled={!totpSetup.secret}
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden />
                          Copy
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="space-y-1 max-w-xs">
                  <Label htmlFor="totp-verify" className="font-mono text-[9px] text-zinc-500 uppercase">
                    6-digit code
                  </Label>
                  <Input
                    id="totp-verify"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    className="font-mono text-xs h-9 bg-background border-[#2a2a2c] focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" className="font-mono text-xs" onClick={verifyTotp} disabled={busy || totpCode.trim().length < 6}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Verify and enable
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="font-mono text-xs" onClick={() => setTotpSetup(null)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-[#2a2a2c] pt-3">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Backup codes</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="font-mono text-xs" onClick={() => setBackupOpen(true)} disabled={busy}>
            View or generate codes
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={() => setBackupRegenOpen(true)}
            disabled={busy}
          >
            Regenerate
          </Button>
        </div>
      </div>

      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent className="border-[#2a2a2c] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">Disable authenticator?</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs text-zinc-400">
              You will no longer be able to use TOTP codes from this authenticator until you set it up again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="font-mono text-xs bg-destructive text-destructive-foreground focus-visible:ring-destructive"
              onClick={(e) => {
                e.preventDefault();
                void disableTotp();
              }}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={backupRegenOpen} onOpenChange={setBackupRegenOpen}>
        <AlertDialogContent className="border-[#2a2a2c] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">Regenerate backup codes?</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs text-zinc-400">
              This invalidates any previous backup codes immediately. Download or copy the new set before you close the dialog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="font-mono text-xs bg-destructive text-destructive-foreground focus-visible:ring-destructive"
              onClick={(e) => {
                e.preventDefault();
                setBackupRegenOpen(false);
                setBackupOpen(true);
                void generateBackupCodes();
              }}
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={backupOpen} onOpenChange={setBackupOpen}>
        <DialogContent className="border-[#2a2a2c] bg-[#121214] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">Backup codes</DialogTitle>
            <DialogDescription className="font-mono text-xs text-zinc-400">
              Codes are shown only here. Store them in a password manager. Each code is one-time use at sign-in.
            </DialogDescription>
          </DialogHeader>
          {backupCodes?.length ? (
            <div className="space-y-2">
              <ul className="font-mono text-[11px] text-zinc-200 space-y-1 max-h-48 overflow-y-auto pr-1 border border-zinc-800 rounded p-2 bg-black/30">
                {backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  onClick={() => void copyText("Backup codes", backupCodes.join("\n"))}
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden />
                  Copy all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs"
                  onClick={() => {
                    const blob = new Blob([backupCodes.join("\n")], { type: "text/plain" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "alpha-terminal-backup-codes.txt";
                    a.click();
                    URL.revokeObjectURL(a.href);
                    toast({ title: "Download started", description: "Backup codes file." });
                  }}
                >
                  <Download className="w-3.5 h-3.5" aria-hidden />
                  Download .txt
                </Button>
              </div>
            </div>
          ) : (
            <p className="font-mono text-[11px] text-zinc-500">Generate a fresh set. Any previous codes will stop working.</p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              className="font-mono text-xs"
              onClick={() => void generateBackupCodes()}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {backupCodes?.length ? "Generate new set" : "Generate codes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SecurityCard>
  );
}

function PasskeysCard({ user }: { user: ClerkUser }) {
  const webAuthnSupported = useWebAuthnSupported();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rename, setRename] = useState<{ passkey: Passkey; name: string } | null>(null);
  const [deletePk, setDeletePk] = useState<Passkey | null>(null);
  const passkeys = user.passkeys ?? [];

  const addPasskey = async () => {
    try {
      setBusyId("add");
      await user.createPasskey();
      await user.reload();
      toast({ title: "Passkey added", description: "You can rename it below." });
    } catch (e) {
      const msg = clerkErrorMessage(e);
      if (!/cancel|abort/i.test(msg)) {
        toast({ title: "Passkey setup failed", description: msg, variant: "destructive" });
      }
    } finally {
      setBusyId(null);
    }
  };

  const saveRename = async () => {
    if (!rename) return;
    setBusyId(rename.passkey.id);
    try {
      await rename.passkey.update({ name: rename.name.trim() || "Passkey" });
      await user.reload();
      setRename(null);
      toast({ title: "Passkey renamed" });
    } catch (e) {
      toast({ title: "Rename failed", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async () => {
    if (!deletePk) return;
    setBusyId(deletePk.id);
    try {
      await deletePk.delete();
      await user.reload();
      setDeletePk(null);
      toast({ title: "Passkey removed" });
    } catch (e) {
      toast({ title: "Remove failed", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SecurityCard title="Passkeys (WebAuthn)" description="Sign in faster on supported devices. Requires HTTPS in production.">
      {!webAuthnSupported ? (
        <p className="font-mono text-[11px] text-amber-500">This browser does not expose WebAuthn passkeys.</p>
      ) : null}
      <Button type="button" size="sm" className="font-mono text-xs" onClick={addPasskey} disabled={!webAuthnSupported || busyId === "add"}>
        {busyId === "add" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Add passkey
      </Button>
      {passkeys.length === 0 ? (
        <p className="font-mono text-[11px] text-zinc-500">No passkeys yet.</p>
      ) : (
        <ul className="space-y-2" role="list">
          {passkeys.map((pk) => (
            <li
              key={pk.id}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded border border-zinc-800/80 p-2 bg-black/20"
            >
              <div>
                <div className="font-mono text-xs text-zinc-200">{pk.name || "Passkey"}</div>
                <div className="font-mono text-[10px] text-zinc-500 mt-0.5">
                  Added {formatWhen(pk.createdAt)}
                  {pk.lastUsedAt ? ` · Last used ${formatWhen(pk.lastUsedAt)}` : " · Not used yet"}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono text-[10px] h-8"
                  onClick={() => setRename({ passkey: pk, name: pk.name })}
                  disabled={!!busyId}
                >
                  Rename
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="font-mono text-[10px] h-8"
                  onClick={() => setDeletePk(pk)}
                  disabled={!!busyId}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!rename} onOpenChange={(o) => !o && setRename(null)}>
        <DialogContent className="border-[#2a2a2c] bg-[#121214]">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">Rename passkey</DialogTitle>
          </DialogHeader>
          {rename ? (
            <div className="space-y-2">
              <Label htmlFor="pk-name" className="font-mono text-[9px] uppercase text-zinc-500">
                Label
              </Label>
              <Input
                id="pk-name"
                value={rename.name}
                onChange={(e) => setRename({ ...rename, name: e.target.value })}
                className="font-mono text-xs h-9 bg-background border-[#2a2a2c]"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="font-mono text-xs" onClick={() => setRename(null)}>
              Cancel
            </Button>
            <Button type="button" className="font-mono text-xs" onClick={() => void saveRename()} disabled={busyId !== null}>
              {busyId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePk} onOpenChange={(o) => !o && setDeletePk(null)}>
        <AlertDialogContent className="border-[#2a2a2c] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">Delete this passkey?</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs text-zinc-400">
              You can add it again later, but devices that relied on this passkey will need to register a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="font-mono text-xs bg-destructive text-destructive-foreground"
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
            >
              Delete passkey
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SecurityCard>
  );
}

function SessionsCard({
  user,
  currentSessionId,
}: {
  user: ClerkUser;
  currentSessionId: string | undefined;
}) {
  const { sessions: clientSessions, isLoaded: sessionsLoaded } = useSessionList();
  const clientIds = useMemo(() => new Set((clientSessions ?? []).map((s) => s.id)), [clientSessions]);
  const [items, setItems] = useState<SessionWithActivities[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SessionWithActivities | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await user.getSessions();
      setItems([...list].sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime()));
    } catch (e) {
      setErr(clerkErrorMessage(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revokeOne = async (s: SessionWithActivities) => {
    setBusyId(s.id);
    try {
      await s.revoke();
      setRevokeTarget(null);
      await refresh();
      await user.reload();
      toast({ title: "Session revoked" });
    } catch (e) {
      toast({ title: "Could not revoke session", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const revokeOthers = async () => {
    if (!items.length || !currentSessionId) return;
    setBulkBusy(true);
    try {
      for (const s of items) {
        if (s.id === currentSessionId) continue;
        if (s.status === "active" || s.status === "pending") {
          try {
            await s.revoke();
          } catch {
            /* continue */
          }
        }
      }
      await refresh();
      await user.reload();
      toast({ title: "Other sessions revoked" });
    } catch (e) {
      toast({ title: "Bulk revoke incomplete", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <SecurityCard
      title="Active sessions"
      description="Rows from your account session list (device and IP when Clerk provides them). useSessionList marks sessions Clerk associates with this browser."
    >
      {loading || !sessionsLoaded ? (
        <div className="flex items-center gap-2 text-zinc-400 font-mono text-xs" role="status" aria-busy="true">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Loading sessions…
        </div>
      ) : err ? (
        <p className="text-xs text-destructive font-mono" role="alert">
          {err}
        </p>
      ) : null}
      {items.length ? (
        <ul className="space-y-2" role="list">
          {items.map((s) => {
            const act = s.latestActivity;
            const isCurrent = currentSessionId != null && s.id === currentSessionId;
            const onThisBrowser = sessionsLoaded && clientIds.has(s.id);
            const labelParts = [act?.deviceType, act?.browserName].filter(Boolean);
            const label = labelParts.length ? labelParts.join(" · ") : "Unknown device";
            const canRevoke = !isCurrent && (s.status === "active" || s.status === "pending");
            return (
              <li
                key={s.id}
                className={`rounded border p-2 ${isCurrent ? "border-primary/50 bg-primary/5" : "border-zinc-800/80 bg-black/20"}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-zinc-200 flex flex-wrap items-center gap-2">
                      {label}
                      {isCurrent ? (
                        <span className="text-[10px] uppercase font-bold text-primary border border-primary/40 rounded px-1.5 py-0.5">
                          This session
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase font-bold text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5">
                          Other
                        </span>
                      )}
                      {onThisBrowser && !isCurrent ? (
                        <span className="text-[10px] uppercase font-bold text-zinc-400 border border-zinc-600 rounded px-1.5 py-0.5">
                          On this browser
                        </span>
                      ) : null}
                    </div>
                    <div className="font-mono text-[10px] text-zinc-500 mt-1 space-y-0.5">
                      <div>IP: {act?.ipAddress ?? "Unknown"}</div>
                      <div>Last active: {formatWhen(s.lastActiveAt)}</div>
                    </div>
                  </div>
                  {canRevoke ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="font-mono text-[10px] h-8 shrink-0"
                      onClick={() => setRevokeTarget(s)}
                      disabled={!!busyId || bulkBusy}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="font-mono text-xs"
        onClick={() => void revokeOthers()}
        disabled={bulkBusy || !currentSessionId || loading || !sessionsLoaded}
        aria-busy={bulkBusy}
      >
        {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Sign out all other sessions
      </Button>

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent className="border-[#2a2a2c] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">Revoke this session?</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs text-zinc-400">
              That device will be signed out on the next request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="font-mono text-xs bg-destructive text-destructive-foreground"
              onClick={(e) => {
                e.preventDefault();
                if (revokeTarget) void revokeOne(revokeTarget);
              }}
            >
              Revoke session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SecurityCard>
  );
}

function SessionTimeoutCard() {
  const { minutes: autoLock, setMinutes: setAutoLock } = useAutoLock();
  return (
    <SecurityCard
      title="Session timeout"
      description="Controls client-side inactivity only. Clerk still applies its own maximum session lifetime from the dashboard, which can sign you out even when this is set to Never."
    >
      <p className="font-mono text-[10px] text-zinc-400 leading-relaxed">
        Finding: this setting updates local idle tracking and calls Clerk sign-out after quiet time. It does not change Clerk
        token TTL. If you still get signed out on Never, the cause is usually Clerk session lifetime or token refresh, not this
        control.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Session timeout options">
        {TIMEOUT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setAutoLock(opt.value as SessionTimeoutMinutes)}
            className={autoLock === opt.value ? BTN_SEG_ON : BTN_SEG_OFF}
            aria-pressed={autoLock === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </SecurityCard>
  );
}

function EmailRow({
  email,
  user,
  isPrimary,
}: {
  email: EmailAddress;
  user: ClerkUser;
  isPrimary: boolean;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "sent">("idle");
  const [removeOpen, setRemoveOpen] = useState(false);

  const verified = email.verification?.status === "verified";

  const sendCode = async () => {
    setBusy(true);
    try {
      await email.prepareVerification({ strategy: "email_code" });
      setPhase("sent");
      toast({ title: "Code sent", description: `Check ${email.emailAddress}` });
    } catch (e) {
      toast({ title: "Could not send code", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setBusy(true);
    try {
      await email.attemptVerification({ code: code.trim() });
      await user.reload();
      setCode("");
      setPhase("idle");
      toast({ title: "Email verified" });
    } catch (e) {
      toast({ title: "Verification failed", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const makePrimary = async () => {
    setBusy(true);
    try {
      await user.update({ primaryEmailAddressId: email.id });
      await user.reload();
      toast({ title: "Primary email updated" });
    } catch (e) {
      toast({ title: "Could not set primary", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await email.destroy();
      setRemoveOpen(false);
      await user.reload();
      toast({ title: "Email removed" });
    } catch (e) {
      toast({ title: "Could not remove email", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded border border-zinc-800/80 p-2 space-y-2 bg-black/20">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-zinc-200">{email.emailAddress}</span>
        {isPrimary ? (
          <span className="text-[10px] font-bold uppercase text-primary border border-primary/40 rounded px-1.5">Primary</span>
        ) : null}
        {verified ? (
          <span className="text-[10px] font-bold uppercase text-emerald-400 border border-emerald-700/50 rounded px-1.5">
            Verified
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase text-amber-400 border border-amber-700/50 rounded px-1.5">
            Unverified
          </span>
        )}
      </div>
      {email.matchesSsoConnection ? (
        <p className="font-mono text-[10px] text-zinc-500">Managed by SSO. Removal may be blocked by your organization.</p>
      ) : null}
      {!verified ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="font-mono text-[10px] h-8" onClick={sendCode} disabled={busy}>
              {busy && phase === "idle" ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Send code
            </Button>
          </div>
          {phase === "sent" ? (
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <Label className="font-mono text-[9px] text-zinc-500 uppercase">Code</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono text-xs h-8 w-40 bg-background border-zinc-800"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </div>
              <Button type="button" size="sm" className="font-mono text-[10px] h-8" onClick={verifyCode} disabled={busy || code.trim().length < 6}>
                Verify
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {verified && !isPrimary ? (
          <Button type="button" variant="outline" size="sm" className="font-mono text-[10px] h-8" onClick={makePrimary} disabled={busy}>
            Set as primary
          </Button>
        ) : null}
        {!isPrimary ? (
          <Button type="button" variant="destructive" size="sm" className="font-mono text-[10px] h-8" onClick={() => setRemoveOpen(true)} disabled={busy}>
            Remove
          </Button>
        ) : null}
      </div>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent className="border-[#2a2a2c] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">Remove this email?</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs text-zinc-400">
              You cannot remove your only identifier. Add another verified email first if this is your last address.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="font-mono text-xs bg-destructive text-destructive-foreground"
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              Remove email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function EmailsCard({ user }: { user: ClerkUser }) {
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await user.createEmailAddress({ email: trimmed });
      setNewEmail("");
      await user.reload();
      toast({ title: "Email added", description: "Verify it from the list." });
    } catch (e) {
      toast({ title: "Could not add email", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const primaryId = user.primaryEmailAddressId;

  return (
    <SecurityCard title="Email addresses" description="Manage addresses for this account. Primary is used for notices where applicable.">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1 flex-1 min-w-[200px]">
          <Label htmlFor="new-email" className="font-mono text-[9px] text-zinc-500 uppercase">
            Add email
          </Label>
          <Input
            id="new-email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="font-mono text-xs h-9 bg-background border-[#2a2a2c]"
            autoComplete="email"
          />
        </div>
        <Button type="button" size="sm" className="font-mono text-xs h-9" onClick={add} disabled={busy || !newEmail.trim()} aria-busy={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Add
        </Button>
      </div>
      <ul className="space-y-2" role="list">
        {user.emailAddresses.map((em) => (
          <EmailRow key={em.id} email={em} user={user} isPrimary={em.id === primaryId} />
        ))}
      </ul>
    </SecurityCard>
  );
}

function providerKey(acc: ExternalAccount): string {
  try {
    return acc.providerSlug();
  } catch {
    return String(acc.provider);
  }
}

function ConnectedAccountsCard({
  user,
  strategies,
}: {
  user: ClerkUser;
  strategies: string[];
}) {
  const [busyStrategy, setBusyStrategy] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<ExternalAccount | null>(null);

  const redirectUrl = useMemo(() => `${window.location.origin}${window.location.pathname || "/"}`, []);

  const connect = async (strategy: string) => {
    setBusyStrategy(strategy);
    try {
      const acc = await user.createExternalAccount({ strategy: strategy as never, redirectUrl });
      const url = acc.verification?.externalVerificationRedirectURL?.href;
      if (url) {
        window.location.assign(url);
      } else {
        toast({
          title: "No redirect URL",
          description: "Clerk did not return an OAuth URL. Check that this provider is enabled.",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Connect failed", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusyStrategy(null);
    }
  };

  const disconnect = async () => {
    if (!disconnectTarget) return;
    setBusyStrategy(disconnectTarget.id);
    try {
      await disconnectTarget.destroy();
      setDisconnectTarget(null);
      await user.reload();
      toast({ title: "Disconnected", description: "OAuth account removed." });
    } catch (e) {
      toast({ title: "Disconnect failed", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusyStrategy(null);
    }
  };

  const reauthorize = async (acc: ExternalAccount) => {
    setBusyStrategy(`re-${acc.id}`);
    try {
      const updated = await acc.reauthorize({ redirectUrl });
      const url = updated.verification?.externalVerificationRedirectURL?.href;
      if (url) window.location.assign(url);
      else toast({ title: "Reauthorize", description: "Open your provider to finish.", variant: "destructive" });
    } catch (e) {
      toast({ title: "Reauthorize failed", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusyStrategy(null);
    }
  };

  const connected = user.externalAccounts ?? [];
  const connectedKeys = new Set(connected.map(providerKey));

  return (
    <SecurityCard title="Connected accounts" description="Link OAuth providers enabled for this Clerk instance.">
      <div className="space-y-2">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Connect</p>
        <div className="flex flex-wrap gap-2">
          {strategies
            .filter((s) => !connectedKeys.has(s.replace(/^oauth_/, "")))
            .map((s) => (
              <Button
                key={s}
                type="button"
                variant="outline"
                size="sm"
                className="font-mono text-[10px] h-8"
                onClick={() => void connect(s)}
                disabled={busyStrategy !== null}
                aria-busy={busyStrategy === s}
              >
                {busyStrategy === s ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Connect {strategyLabel(s)}
              </Button>
            ))}
        </div>
      </div>
      <ul className="space-y-2" role="list">
        {connected.map((acc) => (
          <li key={acc.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded border border-zinc-800/80 p-2 bg-black/20">
            <div>
              <div className="font-mono text-xs text-zinc-200">{acc.providerTitle()}</div>
              <div className="font-mono text-[10px] text-zinc-500">{acc.accountIdentifier()}</div>
              {acc.verification?.status !== "verified" && acc.verification?.externalVerificationRedirectURL ? (
                <button
                  type="button"
                  className="mt-1 font-mono text-[10px] text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  onClick={() => void reauthorize(acc)}
                >
                  Complete verification
                </button>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-mono text-[10px] h-8 shrink-0"
              onClick={() => setDisconnectTarget(acc)}
              disabled={busyStrategy !== null}
            >
              Disconnect
            </Button>
          </li>
        ))}
      </ul>

      <AlertDialog open={!!disconnectTarget} onOpenChange={(o) => !o && setDisconnectTarget(null)}>
        <AlertDialogContent className="border-[#2a2a2c] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm">Disconnect OAuth account?</AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs text-zinc-400">
              You may lose access if this was your only sign-in method for that provider.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="font-mono text-xs bg-destructive text-destructive-foreground"
              onClick={(e) => {
                e.preventDefault();
                void disconnect();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SecurityCard>
  );
}

function DeleteAccountCard({ user }: { user: ClerkUser }) {
  const clerk = useClerk();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);

  const canDelete = user.deleteSelfEnabled && phrase === "DELETE";

  const runDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      await user.delete();
      await clerk.signOut();
      toast({ title: "Account deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: clerkErrorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!user.deleteSelfEnabled) {
    return (
      <SecurityCard
        title="Delete account"
        description="Self-serve deletion is disabled for this instance. Contact support if you need the account removed."
      />
    );
  }

  return (
    <SecurityCard title="Delete account" description="Permanently removes your user. This cannot be undone.">
      <Button type="button" variant="destructive" size="sm" className="font-mono text-xs" onClick={() => setOpen(true)}>
        Delete my account…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-[#2a2a2c] bg-[#121214] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm text-destructive">Delete account</DialogTitle>
            <DialogDescription className="font-mono text-xs text-zinc-400">
              Type DELETE in capitals to confirm. You will be signed out immediately after.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="del-confirm" className="font-mono text-[9px] uppercase text-zinc-500">
              Confirmation
            </Label>
            <Input
              id="del-confirm"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              className="font-mono text-xs h-9 bg-background border-[#2a2a2c]"
              autoComplete="off"
              aria-invalid={phrase.length > 0 && !canDelete}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="font-mono text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="font-mono text-xs"
              disabled={!canDelete || busy}
              onClick={() => void runDelete()}
              aria-busy={busy}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SecurityCard>
  );
}

export function SecurityPrivacyPage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { session } = useSession();
  const clerk = useClerk();

  const oauthStrategies = useMemo(() => getAuthenticatableOAuthStrategies(clerk), [clerk]);

  if (devBypass) {
    return (
      <div className="space-y-6 max-w-xl mx-auto font-mono text-xs text-zinc-400">
        <p>Security settings are unavailable while auth bypass is enabled.</p>
        <SessionTimeoutCard />
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex items-center gap-2 text-zinc-400 font-mono text-sm" role="status" aria-busy="true">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        Loading account…
      </div>
    );
  }

  if (!isSignedIn || !user) {
    return <p className="font-mono text-xs text-zinc-500">Sign in to manage security.</p>;
  }

  return (
    <div className="space-y-6 max-w-xl mx-auto pb-4">
      <PasswordCard user={user} />
      <MfaCard user={user} />
      <PasskeysCard user={user} />
      <SessionsCard user={user} currentSessionId={session?.id} />
      <SessionTimeoutCard />
      <EmailsCard user={user} />
      {oauthStrategies.length > 0 ? <ConnectedAccountsCard user={user} strategies={oauthStrategies} /> : null}
      <DeleteAccountCard user={user} />
    </div>
  );
}
