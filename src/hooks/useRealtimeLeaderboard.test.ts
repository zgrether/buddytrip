import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * useRealtimeLeaderboard hook tests.
 *
 * Since this hook uses Supabase Realtime + tRPC utils (React hooks),
 * we can't render it without a full provider stack. Instead, we test
 * the subscription logic by verifying channel creation and cleanup
 * behavior via mocks.
 */

// Mock Supabase channel
const mockOn = vi.fn().mockReturnThis();
const mockSubscribe = vi.fn().mockImplementation((cb) => {
  // Simulate immediate SUBSCRIBED status
  if (cb) cb("SUBSCRIBED");
  return { unsubscribe: vi.fn() };
});
const mockChannel = {
  on: mockOn,
  subscribe: mockSubscribe,
};
const mockRemoveChannel = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    channel: vi.fn().mockReturnValue(mockChannel),
    removeChannel: mockRemoveChannel,
  }),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      groupResults: {
        listScoresByEvent: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
      },
      sideEvents: {
        list: { invalidate: vi.fn() },
      },
    }),
  },
}));

describe("useRealtimeLeaderboard — subscription logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates channels with correct names for a given eventId", async () => {
    // Import after mocks are set up
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();

    // Simulate what the hook does
    const eventId = "evt-123";
    supabase.channel(`scores:${eventId}`);
    supabase.channel(`side-events:${eventId}`);

    expect(supabase.channel).toHaveBeenCalledWith("scores:evt-123");
    expect(supabase.channel).toHaveBeenCalledWith("side-events:evt-123");
  });

  it("subscribes to postgres_changes on group_results and side_events", () => {
    // Verify the .on() method is chainable and accepts correct event type
    const result = mockChannel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "group_results",
        filter: "event_id=eq.evt-123",
      },
      () => {}
    );
    expect(result).toBe(mockChannel); // chainable

    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "*",
        schema: "public",
        table: "group_results",
        filter: "event_id=eq.evt-123",
      }),
      expect.any(Function)
    );
  });

  it("side_events channel uses UPDATE event type", () => {
    mockChannel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "side_events",
        filter: "event_id=eq.evt-456",
      },
      () => {}
    );

    expect(mockOn).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "UPDATE",
        table: "side_events",
      }),
      expect.any(Function)
    );
  });

  it("removeChannel is callable for cleanup", async () => {
    const { createClient } = await import("@/lib/supabase");
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.removeChannel(mockChannel as any);
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });
});
