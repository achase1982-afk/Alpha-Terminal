export const CLERK_TOKEN_CONNECT_TIMEOUT_MS = 15_000;

export interface WsConnectSession {
  connectGen: number;
  inFlight: boolean;
  ws: WebSocket | null;
  mounted: boolean;
}

export function beginWsConnectAttempt(session: WsConnectSession): number | null {
  if (session.inFlight) return null;
  if (session.ws != null && session.ws.readyState <= WebSocket.OPEN) return null;
  if (!session.mounted) return null;
  session.inFlight = true;
  return ++session.connectGen;
}

export function releaseWsConnectInFlight(session: WsConnectSession, connectGen: number): void {
  if (connectGen === session.connectGen) {
    session.inFlight = false;
  }
}

export function attachWsSocket(session: WsConnectSession, connectGen: number, socket: WebSocket): boolean {
  if (connectGen !== session.connectGen || !session.mounted) {
    return false;
  }
  session.ws = socket;
  return true;
}

export function handleWsSocketClosed(session: WsConnectSession, closing: WebSocket): void {
  if (session.ws === closing) {
    session.ws = null;
  }
  if (session.ws === null) {
    session.inFlight = false;
  }
}

export function shouldAbortAfterToken(
  session: WsConnectSession,
  connectGen: number,
): boolean {
  return (
    connectGen !== session.connectGen ||
    !session.mounted ||
    (session.ws != null && session.ws.readyState <= WebSocket.OPEN)
  );
}

export async function awaitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ ok: true; value: T } | { ok: false; timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return { ok: true, value };
  } catch (e) {
    if (e instanceof Error && e.message === "timeout") {
      return { ok: false, timedOut: true };
    }
    throw e;
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}