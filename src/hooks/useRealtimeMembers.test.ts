import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * useRealtimeMembers — shared-channel registry tests (#791).
 *
 * The previous version of this file asserted the subscription SHAPE by calling
 * the mocks directly (`mockChannel.on(...)`, then expecting `mockOn` to have
 * been called with what the test itself had just passed). That is a tautology:
 * it exercised no hook code and would have passed against any implementation —
 * including the broken one this replaces.
 *
 * What actually had failure modes was the ref-counting, so that is what is
 * tested here, through `acquire` — the exported seam, because the suite runs in
 * `environment: "node"` and there is no renderer to drive the hook itself.
 * Mirrors `useRealtimeChat.test.ts`.
 */

type StatusCb = (status: string) => void;

interface FakeChannel {
  topic: string;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  fire: () => void;
  status: (s: string) => void;
}

let channels: FakeChannel[] = [];
const removeChannel = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getRealtimeClient: () => ({
    channel: (topic: string) => {
      // NOTE: this mock deliberately returns a NEW object per call, unlike
      // supabase-js (which returns the EXISTING channel for a duplicate topic).
      // That makes a duplicate-topic bug visible here as a second entry in
      // `channels`, rather than being silently absorbed by the client the way
      // it was in production. The registry is what must prevent the second
      // call, and these tests should fail if it stops doing so.
      let changeHandler: () => void = () => {};
      let statusCb: StatusCb = () => {};
      const ch: FakeChannel = {
        topic,
        on: vi.fn((_evt: string, _cfg: unknown, cb: () => void) => {
          changeHandler = cb;
          return ch;
        }),
        subscribe: vi.fn((cb: StatusCb) => {
          statusCb = cb;
          return ch;
        }),
        fire: () => changeHandler(),
        status: (s: string) => statusCb(s),
      };
      channels.push(ch);
      return ch;
    },
    removeChannel,
  }),
}));

vi.mock("@/lib/trpc-client", () => ({ trpc: {} }));

beforeEach(() => {
  channels = [];
  removeChannel.mockClear();
});

describe("membersTopic", () => {
  it("is one topic per trip", async () => {
    const { membersTopic } = await import("./useRealtimeMembers");
    expect(membersTopic("trip-1")).toBe("members:trip-1");
    expect(membersTopic("trip-2")).not.toBe(membersTopic("trip-1"));
  });
});

describe("useRealtimeMembers — shared channel registry", () => {
  it("opens ONE channel when two surfaces watch the same trip", async () => {
    const { acquire } = await import("./useRealtimeMembers");
    // The real trip-page shape: page.tsx AND LiveFaceClient (kept mounted by
    // AppShell as the `cup` surface) both subscribe for the same tripId.
    const releaseA = acquire("trip-1", vi.fn());
    const releaseB = acquire("trip-1", vi.fn());

    expect(channels).toHaveLength(1);

    releaseA();
    releaseB();
  });

  it("keeps the channel alive when only ONE of two surfaces unmounts", async () => {
    const { acquire } = await import("./useRealtimeMembers");
    const handlerB = vi.fn();
    const releaseA = acquire("trip-2", vi.fn());
    const releaseB = acquire("trip-2", handlerB);

    releaseA();

    expect(removeChannel).not.toHaveBeenCalled();
    // ...and the survivor still receives events.
    channels[0].fire();
    expect(handlerB).toHaveBeenCalledTimes(1);

    releaseB();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("a double release does not tear down a channel someone else re-acquired", async () => {
    const { acquire } = await import("./useRealtimeMembers");
    const releaseA = acquire("trip-3", vi.fn());
    releaseA();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    removeChannel.mockClear();

    // A new surface mounts and gets a fresh channel...
    const handlerB = vi.fn();
    const releaseB = acquire("trip-3", handlerB);
    // ...and the FIRST surface's cleanup runs a second time (StrictMode / fast
    // refresh). It must be inert, not steal the new subscriber's channel.
    releaseA();

    expect(removeChannel).not.toHaveBeenCalled();
    channels[1].fire();
    expect(handlerB).toHaveBeenCalledTimes(1);

    releaseB();
  });

  it("fans a trip_members change out to every listener", async () => {
    const { acquire } = await import("./useRealtimeMembers");
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = acquire("trip-4", a);
    const releaseB = acquire("trip-4", b);

    channels[0].fire();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    releaseA();
    releaseB();
  });

  it("subscribes to every event on trip_members, filtered to the trip", async () => {
    const { acquire } = await import("./useRealtimeMembers");
    const release = acquire("trip-5", vi.fn());

    expect(channels[0].on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "*",
        schema: "public",
        table: "trip_members",
        filter: "trip_id=eq.trip-5",
      }),
      expect.any(Function)
    );

    release();
  });

  it("backfills every listener on (re)connect", async () => {
    const { acquire } = await import("./useRealtimeMembers");
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = acquire("trip-6", a);
    const releaseB = acquire("trip-6", b);

    channels[0].status("SUBSCRIBED");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    releaseA();
    releaseB();
  });
});

describe("useRealtimeMembers — a dead subscription is not silent", () => {
  for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    it(`reports ${status} instead of failing silently`, async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { acquire } = await import("./useRealtimeMembers");
      const release = acquire(`trip-${status}`, vi.fn());

      channels[0].status(status);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining(status));
      release();
      spy.mockRestore();
    });
  }

  it("says nothing on a healthy SUBSCRIBED", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { acquire } = await import("./useRealtimeMembers");
    const release = acquire("trip-ok", vi.fn());

    channels[0].status("SUBSCRIBED");

    expect(spy).not.toHaveBeenCalled();
    release();
    spy.mockRestore();
  });
});
