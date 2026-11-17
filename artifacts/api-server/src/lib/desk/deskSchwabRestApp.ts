export type DeskSchwabRestApp = "app1" | "app2";

/** Desk REST: app 2 by default; `source=schwab` selects brokerage app 1 credentials. */
export function deskSchwabRestAppFromDeskSource(source: string): DeskSchwabRestApp {
  if (source === "schwab") return "app1";
  return "app2";
}
