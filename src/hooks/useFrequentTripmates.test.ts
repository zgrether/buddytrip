import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * useFrequentTripmates hook tests.
 *
 * Tests the query logic by mocking Supabase responses.
 */

// Mock Supabase
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockIn = vi.fn();

// Build a chainable mock that returns data at each terminal point
function buildChain(result: { data: unknown[] | null; error: null }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  // The final resolved promise
  Object.defineProperty(chain, "then", {
    get() {
      return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    },
  });
  return chain;
}

const mockFrom = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryFn, enabled }: { queryFn: () => Promise<unknown>; enabled: boolean }) => {
    if (!enabled) return { data: undefined };
    // Execute queryFn synchronously for tests — but we need to return the promise result
    // So we just expose the fn for testing
    return { _queryFn: queryFn };
  },
}));

import { useFrequentTripmates } from "./useFrequentTripmates";

describe("useFrequentTripmates", () => {
  const TRIP_ID = "trip-123";
  const USER_ID = "user-me";
  const OTHER_TRIP = "trip-other";
  const USER_A = "user-a";
  const USER_B = "user-b";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when user has no other trips", async () => {
    // First call: get my trips
    mockFrom.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const hook = useFrequentTripmates(TRIP_ID, USER_ID);
    const result = await (hook as unknown as { _queryFn: () => Promise<unknown> })._queryFn();
    expect(result).toEqual([]);
  });

  it("returns top tripmates sorted by frequency", async () => {
    // First call: get my trips
    const fromCalls: Record<string, unknown>[] = [
      // 1: my trips
      {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({ data: [{ trip_id: OTHER_TRIP }], error: null }),
      },
      // 2: tripmates
      {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({
          data: [
            { user_id: USER_A, users: { id: USER_A, name: "Alice", nickname: "Ali", email: "a@x.com" } },
            { user_id: USER_A, users: { id: USER_A, name: "Alice", nickname: "Ali", email: "a@x.com" } },
            { user_id: USER_B, users: { id: USER_B, name: "Bob", nickname: null, email: "b@x.com" } },
          ],
          error: null,
        }),
      },
      // 3: current trip attendees
      {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      },
    ];

    let callIdx = 0;
    mockFrom.mockImplementation(() => fromCalls[callIdx++]);

    const hook = useFrequentTripmates(TRIP_ID, USER_ID);
    const result = await (hook as unknown as { _queryFn: () => Promise<unknown[]> })._queryFn();

    expect(result).toHaveLength(2);
    // Alice appears twice so should be first
    expect((result[0] as { id: string }).id).toBe(USER_A);
    expect((result[1] as { id: string }).id).toBe(USER_B);
  });

  it("excludes users already on the current trip", async () => {
    const fromCalls: Record<string, unknown>[] = [
      // 1: my trips
      {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({ data: [{ trip_id: OTHER_TRIP }], error: null }),
      },
      // 2: tripmates — USER_A is a frequent tripmate
      {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({
          data: [
            { user_id: USER_A, users: { id: USER_A, name: "Alice", nickname: null, email: "a@x.com" } },
          ],
          error: null,
        }),
      },
      // 3: current trip attendees — USER_A is already on this trip
      {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [{ user_id: USER_A }], error: null }),
      },
    ];

    let callIdx = 0;
    mockFrom.mockImplementation(() => fromCalls[callIdx++]);

    const hook = useFrequentTripmates(TRIP_ID, USER_ID);
    const result = await (hook as unknown as { _queryFn: () => Promise<unknown[]> })._queryFn();

    expect(result).toHaveLength(0);
  });

  it("is disabled when userId or tripId is empty", () => {
    const hook1 = useFrequentTripmates("", USER_ID);
    const hook2 = useFrequentTripmates(TRIP_ID, "");
    // With mocked useQuery, enabled=false means no _queryFn
    expect((hook1 as unknown as { _queryFn?: unknown })._queryFn).toBeUndefined();
    expect((hook2 as unknown as { _queryFn?: unknown })._queryFn).toBeUndefined();
  });
});
