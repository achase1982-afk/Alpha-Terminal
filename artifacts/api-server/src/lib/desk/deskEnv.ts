function keysForEnv(name: string): string[] {
  if (name.startsWith("DESK_")) return [name];
  return [`DESK_${name}`, name];
}

/** Read env supporting optional `DESK_` prefix (`DESK_FOO` then `FOO`). */
export function deskEnv(primary: string, ...fallbacks: string[]): string {
  for (const name of [primary, ...fallbacks]) {
    for (const k of keysForEnv(name)) {
      const v = (process.env[k] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

export function deskEnvTruthy(primary: string, ...fallbacks: string[]): boolean {
  const v = deskEnv(primary, ...fallbacks).toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}