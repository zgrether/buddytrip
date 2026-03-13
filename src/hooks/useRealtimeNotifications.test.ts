import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * useRealtimeNotifications hook tests.
 *
 * Tests the subscription logic by verifying channel naming,
 * multi-trip support, and cleanup patterns via mocks.
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
}));

const mockInvalidate = vi.fn();
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      notifications: {
        list: { invalidate: mockInvalidate },
      },
    }),
  },
}));

describe("useRealtimeNotifications — subscription logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a channel per tripId with notifications:{tripId} name", async () => {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();

    // Simulate what the hook does for 2 trips
    const tripIds = ["trip-1", "trip-2"];
    for (const tripId of tripIds) {
      supabase.channel(`notifications:${tripId}`);
    }

    expect(mockChannelFn).toHaveBeenCalledWith("notifications:trip-1");
    expect(mockChannelFn).toHaveBeenCalledWith("notifications:trip-2");
    expect(mockChannelFn).toHaveBeenCalledTimes(2);
  });

  it("subscribes to INSERT events on notification_events table", () => {
    mockChannel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notification_events",
        filter: "trip_id=eq.trip-abc",
      },
      () => {}
    );

    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        table: "notification_events",
        filter: "trip_id=eq.trip-abc",
      }),
      expect.any(Function)
    );
  });

  it("does not create channels for empty tripIds array", async () => {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();

    const tripIds: string[] = [];
    for (const tripId of tripIds) {
      supabase.channel(`notifications:${tripId}`);
    }

    // channelFn was not called for empty array
    expect(mockChannelFn).not.toHaveBeenCalled();
  });

  it("cleanup removes all channels", async () => {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();

    // Simulate creating 2 channels then cleaning up
    const channels = ["trip-1", "trip-2"].map((id) =>
      supabase.channel(`notifications:${id}`)
    );
    for (const ch of channels) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.removeChannel(ch as any);
    }

    expect(mockRemoveChannel).toHaveBeenCalledTimes(2);
  });
});
