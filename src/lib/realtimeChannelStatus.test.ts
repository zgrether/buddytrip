import { describe, it, expect } from "vitest";
import { isDeadChannel } from "./realtimeChannelStatus";

/**
 * #1565: CLOSED after our own teardown is not a dead channel; every other
 * failure status is, whether or not we tore it down.
 */
describe("isDeadChannel", () => {
  it("a CLOSED nobody asked for is dead; one after our teardown is not", () => {
    expect(isDeadChannel("CLOSED", false)).toBe(true);
    expect(isDeadChannel("CLOSED", true)).toBe(false);
  });

  it("an error or a timeout is dead either way", () => {
    for (const tornDown of [false, true]) {
      expect(isDeadChannel("CHANNEL_ERROR", tornDown)).toBe(true);
      expect(isDeadChannel("TIMED_OUT", tornDown)).toBe(true);
    }
  });

  it("a healthy subscribe is not", () => {
    expect(isDeadChannel("SUBSCRIBED", false)).toBe(false);
  });
});
