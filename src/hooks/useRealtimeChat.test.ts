import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Chat realtime — the shared channel registry.
 *
 * REPLACES a test file that asserted against its own mocks: it called
 * `mockChannel.on(...)` itself and then checked `mockOn` had been called,
 * never importing `useRealtimeChat` at all. That passes whatever the hook
 * does, which is why it stayed green through three restructures that each
 * broke chat realtime.
 *
 * What actually has failure modes is the ref-counting — a premature teardown
 * silently kills live updates for a surface that is still mounted, and a
 * duplicate join means one subscriber never receives anything. `acquire` is
 * exported for exactly this reason (same posture as
 * `useRealtimeScoreEvents.test.ts`); the suite runs in `environment: "node"`,
 * so there is no renderer to drive the hook through.
 */

type Sub = (status: string) => void;

class FakeChannel {
  onCalls: Array<{ type: string; filter: unknown; cb: (m: unknown) => void }> = [];
  subCb: Sub | null = null;
  constructor(public topic: string) {}
  on(type: string, filter: unknown, cb: (m: unknown) => void) {
    this.onCalls.push({ type, filter, cb });
    return this;
  }
  subscribe(cb: Sub) {
    this.subCb = cb;
    return this;
  }
  /** Deliver a postgres_changes INSERT to whatever the hook registered. */
  emitInsert(row: unknown) {
    for (const c of this.onCalls) c.cb({ new: row });
  }
  /** Drive the subscribe callback the way Supabase would. */
  status(s: string) {
    this.subCb?.(s);
  }
}

const created: FakeChannel[] = [];
const removed: FakeChannel[] = [];

vi.mock("@/lib/supabase", () => ({
  getRealtimeClient: () => ({
    channel: (topic: string) => {
      const c = new FakeChannel(topic);
      created.push(c);
      return c;
    },
    removeChannel: (c: FakeChannel) => {
      removed.push(c);
    },
  }),
}));

vi.mock("@/lib/trpc-client", () => ({ trpc: { useUtils: () => ({}) } }));

const { acquire, tripChatTopic, teamChatTopic } = await import("./useRealtimeChat");

const TOPIC = tripChatTopic("trip-abc");
const FILTER = "trip_id=eq.trip-abc";

beforeEach(() => {
  created.length = 0;
  removed.length = 0;
});

describe("chat topics", () => {
  it("gives crew and planning ONE shared trip topic, not one each", () => {
    // Both sub-channels ride a single trip channel — the postgres_changes
    // filter is trip_id, and visibility is partitioned client-side.
    expect(tripChatTopic("t1")).toBe("trip-chat:t1");
    expect(teamChatTopic("t1", "team-9")).toBe("team-chat:t1:team-9");
    expect(tripChatTopic("t1")).not.toBe(teamChatTopic("t1", "team-9"));
  });
});

describe("useRealtimeChat — shared channel registry", () => {
  it("opens ONE channel when two surfaces watch the same trip's chat", () => {
    // The exact live case: AppShell holds one subscription, TopNav's
    // ChatToolButton (via useChatUnreadCount) holds another.
    const a = vi.fn();
    const b = vi.fn();
    const relA = acquire(TOPIC, FILTER, a);
    const relB = acquire(TOPIC, FILTER, b);

    expect(created).toHaveLength(1);

    created[0].emitInsert({ id: "m-1", visibility: "crew" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    relA();
    relB();
  });

  it("keeps the channel alive when only ONE of two surfaces unmounts", () => {
    // The regression that made a doc comment insufficient: a naive unmount
    // removeChannel'd a topic the surviving surface still needed.
    const a = vi.fn();
    const b = vi.fn();
    const relA = acquire(TOPIC, FILTER, a);
    const relB = acquire(TOPIC, FILTER, b);

    relA();
    expect(removed).toHaveLength(0);

    created[0].emitInsert({ id: "m-2", visibility: "crew" });
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();

    relB();
    expect(removed).toHaveLength(1);
  });

  it("tears down only on the LAST release", () => {
    const relA = acquire(TOPIC, FILTER, vi.fn());
    const relB = acquire(TOPIC, FILTER, vi.fn());
    relA();
    relB();
    expect(removed).toHaveLength(1);
  });

  it("a double release does not tear down a channel someone else re-acquired", () => {
    // StrictMode / fast refresh can run an effect cleanup twice.
    const relA = acquire(TOPIC, FILTER, vi.fn());
    relA();
    expect(removed).toHaveLength(1);

    const relB = acquire(TOPIC, FILTER, vi.fn());
    expect(created).toHaveLength(2);

    relA(); // second call — must be inert
    expect(removed).toHaveLength(1);

    const b = vi.fn();
    const relC = acquire(TOPIC, FILTER, b);
    created[1].emitInsert({ id: "m-3", visibility: "crew" });
    expect(b).toHaveBeenCalledTimes(1);

    relB();
    relC();
  });

  it("subscribes to INSERT on messages with the caller's filter", () => {
    const rel = acquire(TOPIC, FILTER, vi.fn());
    expect(created[0].onCalls[0].type).toBe("postgres_changes");
    expect(created[0].onCalls[0].filter).toMatchObject({
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: FILTER,
    });
    rel();
  });

  it("backfills every listener on (re)connect with a resync event", () => {
    const a = vi.fn();
    const b = vi.fn();
    const relA = acquire(TOPIC, FILTER, a);
    const relB = acquire(TOPIC, FILTER, b);

    created[0].status("SUBSCRIBED");
    expect(a).toHaveBeenCalledWith({ type: "resync" });
    expect(b).toHaveBeenCalledWith({ type: "resync" });

    relA();
    relB();
  });

  it("delivers an insert as an insert event carrying the row", () => {
    const a = vi.fn();
    const rel = acquire(TOPIC, FILTER, a);
    const row = { id: "m-9", visibility: "planning", text: "hi" };
    created[0].emitInsert(row);
    expect(a).toHaveBeenCalledWith({ type: "insert", row });
    rel();
  });
});

describe("useRealtimeChat — a dead subscription is not silent", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
  });

  // Failing silently is what made this read as "barely working" rather than
  // "broken", across three restructures.
  for (const status of ["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]) {
    it(`reports ${status} instead of failing silently`, () => {
      const rel = acquire(TOPIC, FILTER, vi.fn());
      created[0].status(status);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toContain(TOPIC);
      expect(String(spy.mock.calls[0][0])).toContain(status);
      rel();
    });
  }

  it("says nothing on a healthy SUBSCRIBED", () => {
    const rel = acquire(TOPIC, FILTER, vi.fn());
    created[0].status("SUBSCRIBED");
    expect(spy).not.toHaveBeenCalled();
    rel();
  });
});
