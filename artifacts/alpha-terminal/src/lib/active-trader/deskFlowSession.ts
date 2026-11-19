/** Apply a flow meta event. A later `sessionClosed: false` clears a latched close. */
export function reduceFlowSessionClosed(
  prev: boolean,
  meta: { sessionClosed?: boolean } | null | undefined,
): boolean {
  if (!meta || typeof meta.sessionClosed !== "boolean") return prev;
  return meta.sessionClosed;
}
