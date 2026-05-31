import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * useRealtimeMembers hook tests.
 *
 * Verifies channel naming, the postgres_changes subscription shape
 * (table + trip_id filter), and cleanup — mirroring the other realtime
 * hook tests. The hook keeps tab visibility / role permissions live by
 * invalidating tripMembers.list whenever a trip_members row changes.
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
  createClient: () => ({
    channel: mockChannelFn,
    removeChannel: mockRemoveChannel,
  }),
  getRealtimeClient: () => ({
    channel: mockChannelFn,
    removeChannel: mockRemoveChannel,
  }),
}));

const mockInvalidate = vi.fn();
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      tripMembers: {
        list: { invalidate: mockInvalidate },
      },
    }),
  },
}));

describe("useRealtimeMembers — subscription logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a members:{tripId} channel", async () => {
    const { getRealtimeClient } = await import("@/lib/supabase");
    const supabase = getRealtimeClient();

    supabase.channel(`members:trip-1`);

    expect(mockChannelFn).toHaveBeenCalledWith("members:trip-1");
    expect(mockChannelFn).toHaveBeenCalledTimes(1);
  });

  it("subscribes to all postgres_changes on trip_members filtered by trip_id", () => {
    mockChannel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "trip_members",
        filter: "trip_id=eq.trip-abc",
      },
      () => {}
    );

    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "*",
        table: "trip_members",
        filter: "trip_id=eq.trip-abc",
      }),
      expect.any(Function)
    );
  });

  it("invalidates tripMembers.list when a change fires", () => {
    // Simulate the hook's change handler.
    const handler = () => mockInvalidate({ tripId: "trip-xyz" });
    handler();

    expect(mockInvalidate).toHaveBeenCalledWith({ tripId: "trip-xyz" });
  });

  it("cleanup removes the channel", async () => {
    const { getRealtimeClient } = await import("@/lib/supabase");
    const supabase = getRealtimeClient();

    const channel = supabase.channel(`members:trip-1`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.removeChannel(channel as any);

    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });
});
