import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The golf routes take today's cap THEMSELVES, in the request that spends the
 * key (`takeGolfApiCall`).
 *
 * It used to be a separate tRPC call the app was trusted to make first, so a
 * request straight to the route spent the key without counting. The session
 * and the counter are faked at `@/lib/supabase-server`, so the real gate and
 * the real `takeGolfApiCall` run; `record_api_call`'s own atomicity is tested
 * against the database in `courses.test.ts`.
 *
 * "No outbound fetch" is the mechanism under test, not just the status.
 */

let counter: () => Promise<{ data: unknown; error: unknown }> = async () => ({ data: 1, error: null });
const rpc = vi.fn((..._args: unknown[]) => counter());

vi.mock("@/lib/supabase-server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpc(...args),
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "user-1" } }, error: null }),
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
  }),
}));

import { GET as searchGET } from "./search/route";
import { GET as courseGET } from "./[courseId]/route";

const ROUTES: Array<[string, () => Promise<Response>]> = [
  ["search", () => searchGET(new NextRequest("http://localhost/api/golf-courses/search?q=Pebble"))],
  [
    "course detail",
    () => courseGET(new NextRequest("http://localhost/api/golf-courses/123"), { params: Promise.resolve({ courseId: "123" }) }),
  ],
];

describe("the golf routes enforce the daily cap themselves", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.GOLFCOURSE_API_KEY;
    process.env.GOLFCOURSE_API_KEY = "test-key";
    fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ courses: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockClear();
    counter = async () => ({ data: 1, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (savedKey === undefined) delete process.env.GOLFCOURSE_API_KEY;
    else process.env.GOLFCOURSE_API_KEY = savedKey;
  });

  it.each(ROUTES)("%s: at the cap, 429 and no call goes out", async (_n, call) => {
    counter = async () => ({ data: -1, error: null });
    const res = await call();
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("%s: a failed count is not 'under the cap' — 503, no call goes out", async (_n, call) => {
    counter = async () => ({ data: null, error: { message: "upstream 502" } });
    const res = await call();
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("%s: CONTROL — under the cap, one call is counted and goes out", async (_n, call) => {
    await call();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_api_call", { p_provider: "golfcourseapi", p_limit: 50 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a search too short to run is never counted", async () => {
    await searchGET(new NextRequest("http://localhost/api/golf-courses/search?q=P"));
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
