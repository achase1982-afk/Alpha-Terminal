const LS_KEY = "alphaTerminalSecurityPrefs";

export interface SecurityPrefs {
  sessionTimeout: number;
  biometricLogin: boolean;
  biometricSensitiveData: boolean;
  biometricTradeConfirmation: boolean;
}

const DEFAULTS: SecurityPrefs = {
  sessionTimeout: 30,
  biometricLogin: false,
  biometricSensitiveData: false,
  biometricTradeConfirmation: false,
};

export const TIMEOUT_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "60 min" },
  { value: 90, label: "90 min" },
  { value: 0, label: "Never" },
];

const VALID_TIMEOUTS = new Set(TIMEOUT_OPTIONS.map((o) => o.value));

export function readSecurityPrefs(): SecurityPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const legacyKey = "at_auto_lock_minutes";
      const legacy = localStorage.getItem(legacyKey);
      if (legacy !== null) {
        const n = Number(legacy);
        const timeout = VALID_TIMEOUTS.has(n) ? n : DEFAULTS.sessionTimeout;
        const migrated = { ...DEFAULTS, sessionTimeout: timeout };
        writeSecurityPrefs(migrated);
        try { localStorage.removeItem(legacyKey); } catch {}
        return migrated;
      }
      return { ...DEFAULTS };
    }
    const parsed = JSON.parse(raw);
    return {
      sessionTimeout: VALID_TIMEOUTS.has(parsed.sessionTimeout)
        ? parsed.sessionTimeout
        : DEFAULTS.sessionTimeout,
      biometricLogin: typeof parsed.biometricLogin === "boolean" ? parsed.biometricLogin : DEFAULTS.biometricLogin,
      biometricSensitiveData: typeof parsed.biometricSensitiveData === "boolean" ? parsed.biometricSensitiveData : DEFAULTS.biometricSensitiveData,
      biometricTradeConfirmation: typeof parsed.biometricTradeConfirmation === "boolean" ? parsed.biometricTradeConfirmation : DEFAULTS.biometricTradeConfirmation,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSecurityPrefs(prefs: SecurityPrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {}
}

export function updateSecurityPref<K extends keyof SecurityPrefs>(
  key: K,
  value: SecurityPrefs[K],
): SecurityPrefs {
  const current = readSecurityPrefs();
  const updated = { ...current, [key]: value };
  writeSecurityPrefs(updated);
  return updated;
}
