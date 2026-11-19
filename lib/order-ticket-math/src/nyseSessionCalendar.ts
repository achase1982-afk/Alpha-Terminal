/** NYSE cash holidays and 1:00 PM ET early closes. Options follow the same days. */

export const NYSE_HOLIDAYS: Record<string, string> = {
  "2025-01-01": "New Year's Day",
  "2025-01-09": "National Day of Mourning",
  "2025-01-20": "MLK Jr. Day",
  "2025-02-17": "Presidents' Day",
  "2025-04-18": "Good Friday",
  "2025-05-26": "Memorial Day",
  "2025-06-19": "Juneteenth",
  "2025-07-04": "Independence Day",
  "2025-09-01": "Labor Day",
  "2025-11-27": "Thanksgiving Day",
  "2025-12-25": "Christmas Day",

  "2026-01-01": "New Year's Day",
  "2026-01-19": "MLK Jr. Day",
  "2026-02-16": "Presidents' Day",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day (Observed)",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving Day",
  "2026-12-25": "Christmas Day",

  "2027-01-01": "New Year's Day",
  "2027-01-18": "MLK Jr. Day",
  "2027-02-15": "Presidents' Day",
  "2027-03-26": "Good Friday",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth (Observed)",
  "2027-07-05": "Independence Day (Observed)",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving Day",
  "2027-12-24": "Christmas Day (Observed)",
};

export const NYSE_EARLY_CLOSE: Record<string, string> = {
  "2025-07-03": "Independence Day Eve",
  "2025-11-28": "Day After Thanksgiving",
  "2025-12-24": "Christmas Eve",

  "2026-11-27": "Day After Thanksgiving",
  "2026-12-24": "Christmas Eve",

  "2027-11-26": "Day After Thanksgiving",
};

export function isNyseHoliday(ymd: string): boolean {
  return ymd in NYSE_HOLIDAYS;
}

export function isNyseEarlyClose(ymd: string): boolean {
  return ymd in NYSE_EARLY_CLOSE;
}
