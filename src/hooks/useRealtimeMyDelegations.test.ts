import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * useRealtimeMyDelegations — shared-channel registry tests. Mirrors
 * useRealtimeMembers.test.ts: the part with real failure modes is the
 * ref-counting, tested through `acquire` (the exported seam) since the suite
 * runs in `environment: "node"` and there is no renderer to drive the hook.
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
      // Deliberately a NEW object per call (unlike supabase-js, which returns
      // the EXISTING channel for a duplicate topic) — a duplicate-topic bug
      // shows up here as a second entry in `channels` instead of being
      // silently absorbed, so these tests fail if the registry stops
      // preventing the second call.
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

describe("myDelegationsTopic", () => {
  it("is one topic per user, not per trip", async () => {
    const { myDelegationsTopic } = await import("./useRealtimeMyDelegations");
    expect(myDelegationsTopic("user-1")).toBe("my-delegations:user-1");
    expect(myDelegationsTopic("user-2")).not.toBe(myDelegationsTopic("user-1"));
  });
});

describe("useRealtimeMyDelegations — shared channel registry", () => {
  it("opens ONE channel when two surfaces watch the same user", async () => {
    const { acquire } = await import("./useRealtimeMyDelegations");
    const releaseA = acquire("user-1", vi.fn());
    const releaseB = acquire("user-1", vi.fn());

    expect(channels).toHaveLength(1);

    releaseA();
    releaseB();
  });

  it("keeps the channel alive when only ONE of two surfaces unmounts", async () => {
    const { acquire } = await import("./useRealtimeMyDelegations");
    const handlerB = vi.fn();
    const releaseA = acquire("user-2", vi.fn());
    const releaseB = acquire("user-2", handlerB);

    releaseA();

    expect(removeChannel).not.toHaveBeenCalled();
    channels[0].fire();
    expect(handlerB).toHaveBeenCalledTimes(1);

    releaseB();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  it("a double release does not tear down a channel someone else re-acquired", async () => {
    const { acquire } = await import("./useRealtimeMyDelegations");
    const releaseA = acquire("user-3", vi.fn());
    releaseA();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    removeChannel.mockClear();

    const handlerB = vi.fn();
    const releaseB = acquire("user-3", handlerB);
    // The first surface's cleanup running a second time (StrictMode / fast
    // refresh) must be inert, not steal the new subscriber's channel.
    releaseA();

    expect(removeChannel).not.toHaveBeenCalled();
    channels[1].fire();
    expect(handlerB).toHaveBeenCalledTimes(1);

    releaseB();
  });

  it("fans a game_delegates change out to every listener", async () => {
    const { acquire } = await import("./useRealtimeMyDelegations");
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = acquire("user-4", a);
    const releaseB = acquire("user-4", b);

    channels[0].fire();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    releaseA();
    releaseB();
  });

  it("subscribes to every event on game_delegates, filtered to the viewer's own rows", async () => {
    const { acquire } = await import("./useRealtimeMyDelegations");
    const release = acquire("user-5", vi.fn());

    expect(channels[0].on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "*",
        schema: "public",
        table: "game_delegates",
        filter: "user_id=eq.user-5",
      }),
      expect.any(Function)
    );

    release();
  });

  it("backfills every listener on (re)connect", async () => {
    const { acquire } = await import("./useRealtimeMyDelegations");
    const a = vi.fn();
    const b = vi.fn();
    const releaseA = acquire("user-6", a);
    const releaseB = acquire("user-6", b);

    channels[0].status("SUBSCRIBED");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    releaseA();
    releaseB();
  });
});

describe("useRealtimeMyDelegations — a dead subscription is not silent", () => {
  for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    it(`reports ${status} instead of failing silently`, async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { acquire } = await import("./useRealtimeMyDelegations");
      const release = acquire(`user-${status}`, vi.fn());

      channels[0].status(status);

      expect(spy).toHaveBeenCalledWith(expect.stringContaining(status));
      release();
      spy.mockRestore();
    });
  }

  it("says nothing on a healthy SUBSCRIBED", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { acquire } = await import("./useRealtimeMyDelegations");
    const release = acquire("user-ok", vi.fn());

    channels[0].status("SUBSCRIBED");

    expect(spy).not.toHaveBeenCalled();
    release();
    spy.mockRestore();
  });
});
