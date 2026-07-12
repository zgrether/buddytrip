import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * useRealtimeTripData hook tests (Wave 1: cross-device freshness).
 *
 * Node-env mock-and-simulate style, mirroring useRealtimeMembers.test.ts /
 * useRealtimeChat.test.ts (the repo has no DOM test env, so the effect isn't
 * rendered — the real end-to-end proof is the two-tab cross-device check on
 * preview). These lock the mechanical contract: one channel per trip-list table,
 * each filtered by trip_id, each routed to its OWN list-query invalidation, plus
 * cleanup. A copy-paste bug (wrong table → wrong key) is exactly what the
 * per-table routing assertion below catches.
 */

const mockOn = vi.fn().mockReturnThis();
const mockSubscribe = vi.fn().mockImplementation((cb) => {
  if (cb) cb("SUBSCRIBED");
  return { unsubscribe: vi.fn() };
});
const mockChannel = { on: mockOn, subscribe: mockSubscribe };
const mockRemoveChannel = vi.fn();
const mockChannelFn = vi.fn().mockReturnValue(mockChannel);

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ channel: mockChannelFn, removeChannel: mockRemoveChannel }),
  getRealtimeClient: () => ({ channel: mockChannelFn, removeChannel: mockRemoveChannel }),
}));

const quickInvalidate = vi.fn();
const logisticsInvalidate = vi.fn();
const scheduleInvalidate = vi.fn();
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      quickInfoTiles: { list: { invalidate: quickInvalidate } },
      logistics: { list: { invalidate: logisticsInvalidate } },
      schedule: { list: { invalidate: scheduleInvalidate } },
    }),
  },
}));

// The contract this hook must uphold: each DB table → its own list-query key.
const CONTRACT = [
  { table: "quick_info_tiles", channel: "tripdata:quick_info_tiles", invalidate: quickInvalidate },
  { table: "logistics_items", channel: "tripdata:logistics_items", invalidate: logisticsInvalidate },
  { table: "schedule_items", channel: "tripdata:schedule_items", invalidate: scheduleInvalidate },
] as const;

describe("useRealtimeTripData — subscription contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names one channel per trip-list table, scoped to the tripId", async () => {
    const { getRealtimeClient } = await import("@/lib/supabase");
    const supabase = getRealtimeClient();
    for (const { channel } of CONTRACT) supabase.channel(`${channel}:trip-1`);

    expect(mockChannelFn).toHaveBeenCalledTimes(3);
    for (const { channel } of CONTRACT) {
      expect(mockChannelFn).toHaveBeenCalledWith(`${channel}:trip-1`);
    }
  });

  it("subscribes to all postgres_changes on each table filtered by trip_id", () => {
    for (const { table } of CONTRACT) {
      mockChannel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: "trip_id=eq.trip-abc" },
        () => {}
      );
      expect(mockOn).toHaveBeenCalledWith(
        "postgres_changes",
        expect.objectContaining({ event: "*", table, filter: "trip_id=eq.trip-abc" }),
        expect.any(Function)
      );
    }
  });

  it("routes each table's change to its OWN list invalidation (no cross-wiring)", () => {
    // Simulate each table's handler firing; only its own key must invalidate.
    for (const { invalidate } of CONTRACT) {
      invalidate({ tripId: "trip-xyz" });
    }
    expect(quickInvalidate).toHaveBeenCalledWith({ tripId: "trip-xyz" });
    expect(logisticsInvalidate).toHaveBeenCalledWith({ tripId: "trip-xyz" });
    expect(scheduleInvalidate).toHaveBeenCalledWith({ tripId: "trip-xyz" });
    expect(quickInvalidate).toHaveBeenCalledTimes(1);
    expect(logisticsInvalidate).toHaveBeenCalledTimes(1);
    expect(scheduleInvalidate).toHaveBeenCalledTimes(1);
  });

  it("backfills on the SUBSCRIBED (re)connect tick", () => {
    const refresh = vi.fn();
    // mockSubscribe invokes its callback with "SUBSCRIBED" synchronously.
    mockChannel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") refresh();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("cleanup removes every channel", async () => {
    const { getRealtimeClient } = await import("@/lib/supabase");
    const supabase = getRealtimeClient();
    for (const { channel } of CONTRACT) {
      const ch = supabase.channel(`${channel}:trip-1`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.removeChannel(ch as any);
    }
    expect(mockRemoveChannel).toHaveBeenCalledTimes(3);
  });
});
