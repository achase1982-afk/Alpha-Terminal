/** Browser IANA timezone for server-side market session resolution. */
export function getClientTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function appendClientTimeZoneToUrl(url: string): string {
  const tz = encodeURIComponent(getClientTimeZone());
  const sep = url.includes("?") ? "&" : "?";
  if (/[?&]clientTimeZone=/.test(url)) return url;
  return `${url}${sep}clientTimeZone=${tz}`;
}
