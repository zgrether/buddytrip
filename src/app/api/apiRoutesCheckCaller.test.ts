import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Every API route outside tRPC decides for ITSELF who is calling, and refuses
 * when it can't tell.
 *
 * The middleware passes a request through when its own auth check stalls, by
 * design, and these routes spend paid API keys and make outbound fetches. So
 * each route asks again through `routeCaller`, which fails CLOSED.
 *
 * The session is faked at `@/lib/supabase-server`, the one thing `routeCaller`
 * reads, so the real resolution runs. Every request is valid enough that,
 * without the gate, the route WOULD call its upstream: the control proves it,
 * and "no outbound fetch" is the mechanism, not just the status code.
 */

type Session = "signed-in" | "signed-out" | "unknown";
let session: Session = "signed-in";

vi.mock("@/lib/supabase-server", () => ({
  createClient: async () => ({
    // The golf routes take today's cap with this client; under the cap here.
    rpc: async () => ({ data: 1, error: null }),
    auth: {
      getClaims: async () => {
        if (session === "signed-in") return { data: { claims: { sub: "user-1" } }, error: null };
        if (session === "signed-out") return { data: null, error: null };
        throw new Error("auth server unreachable");
      },
      getUser: async () => {
        if (session === "unknown") throw new Error("auth server unreachable");
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

import { POST as placesPOST, GET as placesGET } from "./places/route";
import { GET as golfSearchGET } from "./golf-courses/search/route";
import { GET as golfCourseGET } from "./golf-courses/[courseId]/route";
import { POST as lodgingPOST } from "./lodging-meta/route";
import { GET as scheduleGET } from "./matchups/schedule/route";
import { GET as teamsGET } from "./matchups/teams/route";

const at = (path: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined
      ? { body: JSON.stringify(init.body), headers: { "Content-Type": "application/json" } }
      : {}),
  });

const ROUTES: Array<[string, () => Promise<Response>]> = [
  ["POST /api/places", () => placesPOST(at("/api/places", { method: "POST", body: { query: "Pebble" } }))],
  ["GET /api/places", () => placesGET(at("/api/places?placeId=ChIJN1t_tDeuEmsRUsoyG83frY4"))],
  ["GET /api/golf-courses/search", () => golfSearchGET(at("/api/golf-courses/search?q=Pebble"))],
  [
    "GET /api/golf-courses/[courseId]",
    () => golfCourseGET(at("/api/golf-courses/123"), { params: Promise.resolve({ courseId: "123" }) }),
  ],
  [
    "POST /api/lodging-meta",
    () => lodgingPOST(at("/api/lodging-meta", { method: "POST", body: { url: "https://www.airbnb.com/rooms/1" } })),
  ],
  ["GET /api/matchups/schedule", () => scheduleGET(at("/api/matchups/schedule?league=nfl&teamId=1"))],
  ["GET /api/matchups/teams", () => teamsGET(at("/api/matchups/teams?league=nfl"))],
];

describe("API routes check the caller themselves", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["GOOGLE_PLACES_API_KEY", "GOLFCOURSE_API_KEY"]) {
      saved[k] = process.env[k];
      process.env[k] = "test-key";
    }
    fetchMock = vi.fn().mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    session = "signed-in";
  });

  it.each(ROUTES)("%s: signed out gets a 401 and never calls out", async (_name, call) => {
    session = "signed-out";
    const res = await call();
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("%s: when the caller can't be confirmed, 503 and never calls out", async (_name, call) => {
    session = "unknown";
    const res = await call();
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("%s: CONTROL — signed in, the route reaches its upstream", async (_name, call) => {
    session = "signed-in";
    await call();
    expect(fetchMock).toHaveBeenCalled();
  });
});
