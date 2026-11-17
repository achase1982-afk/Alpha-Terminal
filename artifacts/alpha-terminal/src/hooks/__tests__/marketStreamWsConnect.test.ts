import { describe, expect, it } from "vitest";
import {
  attachWsSocket,
  beginWsConnectAttempt,
  handleWsSocketClosed,
  releaseWsConnectInFlight,
  type WsConnectSession,
} from "../marketStreamWsConnect";

function session(): WsConnectSession & { ws: WebSocket | null } {
  return {
    connectGen: 0,
    inFlight: false,
    ws: null,
    mounted: true,
  };
}

describe("marketStreamWsConnect", () => {
  it("blocks overlapping connect attempts while in flight", () => {
    const s = session();
    const first = beginWsConnectAttempt(s);
    const second = beginWsConnectAttempt(s);
    expect(first).toBe(1);
    expect(second).toBeNull();
    releaseWsConnectInFlight(s, first!);
    const third = beginWsConnectAttempt(s);
    expect(third).toBe(2);
  });

  it("late close from a stale socket does not clear the active ref", () => {
    const s = session();
    const oldSocket = { id: "old" } as unknown as WebSocket;
    const newSocket = { id: "new" } as unknown as WebSocket;
    s.ws = newSocket;
    handleWsSocketClosed(s, oldSocket);
    expect(s.ws).toBe(newSocket);
    handleWsSocketClosed(s, newSocket);
    expect(s.ws).toBeNull();
    expect(s.inFlight).toBe(false);
  });

  it("only one connect attempt runs while the first is still in flight", () => {
    const s = session();
    const gen1 = beginWsConnectAttempt(s)!;
    expect(beginWsConnectAttempt(s)).toBeNull();
    const socketA = { tag: "a" } as unknown as WebSocket;
    expect(attachWsSocket(s, gen1, socketA)).toBe(true);
    expect(beginWsConnectAttempt(s)).toBeNull();
    releaseWsConnectInFlight(s, gen1);
    const gen2 = beginWsConnectAttempt(s)!;
    const socketB = { tag: "b" } as unknown as WebSocket;
    expect(attachWsSocket(s, gen2, socketB)).toBe(true);
    expect(s.ws).toBe(socketB);
    handleWsSocketClosed(s, socketA);
    expect(s.ws).toBe(socketB);
  });
});