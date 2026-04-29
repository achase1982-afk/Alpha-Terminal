export interface StrategistNotificationSettings {
  toastEnabled: boolean;
  soundEnabled: boolean;
  pushEnabled: boolean;
}

export const DEFAULT_STRATEGIST_NOTIFICATION_SETTINGS: StrategistNotificationSettings = {
  toastEnabled: true,
  soundEnabled: false,
  pushEnabled: true,
};

const KEY = "alpha_strategist_notification_settings";

export function readStrategistNotificationSettings(): StrategistNotificationSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STRATEGIST_NOTIFICATION_SETTINGS;
    return { ...DEFAULT_STRATEGIST_NOTIFICATION_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STRATEGIST_NOTIFICATION_SETTINGS;
  }
}

export function writeStrategistNotificationSettings(settings: StrategistNotificationSettings): void {
  window.localStorage.setItem(KEY, JSON.stringify(settings));
}
