import { describe, expect, it, vi } from "vitest";
import * as streamer from "../../schwabStreamer.js";
import { deskTapeUniverseOnStreamerLogin } from "../deskTapeUniverse.js";

describe("deskTapeUniverseOnStreamerLogin", () => {
  it("does not call deskStreamerReplayDeskAdds (login path owns the single replay)", () => {
    const spy = vi.spyOn(streamer, "deskStreamerReplayDeskAdds");
    spy.mockImplementation(() => undefined);
    deskTapeUniverseOnStreamerLogin();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
