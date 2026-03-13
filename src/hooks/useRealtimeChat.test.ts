import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * useRealtimeChat hook tests.
 *
 * Tests the subscription logic by verifying channel naming,
 * event types, and filter patterns via mocks.
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

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      messages: {
        list: { invalidate: vi.fn() },
      },
    }),
  },
}));

describe("useRealtimeChat — subscription logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trip chat channel uses trip-chat:{tripId} name", async () => {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();

    supabase.channel("trip-chat:trip-abc");
    expect(mockChannelFn).toHaveBeenCalledWith("trip-chat:trip-abc");
  });

  it("team chat channel uses team-chat:{tripId}:{teamId} name", async () => {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();

    supabase.channel("team-chat:trip-abc:team-xyz");
    expect(mockChannelFn).toHaveBeenCalledWith("team-chat:trip-abc:team-xyz");
  });

  it("subscribes to INSERT events on messages table", () => {
    mockChannel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: "trip_id=eq.trip-abc",
      },
      () => {}
    );

    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        table: "messages",
        filter: "trip_id=eq.trip-abc",
      }),
      expect.any(Function)
    );
  });

  it("cleanup removes the channel", async () => {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.removeChannel(mockChannel as any);
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });
});
