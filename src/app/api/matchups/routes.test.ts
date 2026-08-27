import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as teamsGET } from "./teams/route";
import { GET as scheduleGET } from "./schedule/route";

/**
 * The matchup proxy routes, and specifically HOW THEY FAIL.
 *
 * ESPN is undocumented and unofficial. The design bet is that manual entry is
 * the base case and the search is additive — which is only true if a bad day at
 * ESPN produces an empty search box rather than an error that takes a working
 * form down with it. These tests are that bet, written down.
 *
 * Every failure mode gets the same answer: `[]`, HTTP 200.
 */

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

const req = (url: string) => new NextRequest(new URL(url, "http://localhost"));

describe("GET /api/matchups/teams", () => {
  it("normalizes a real-shaped payload down to the four searchable fields", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sports: [
          {
            leagues: [
              {
                teams: [
                  {
                    team: {
                      id: "194",
                      displayName: "Ohio State Buckeyes",
                      shortDisplayName: "Ohio State",
                      abbreviation: "OSU",
                      // The 1.85 MB the browser must never receive.
                      logos: [{ href: "…" }],
                      links: [{ href: "…" }],
                      color: "bb0000",
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const body = await (await teamsGET(req("/api/matchups/teams?league=cfb"))).json();
    expect(body).toEqual([
      { id: "194", displayName: "Ohio State Buckeyes", shortName: "Ohio State", abbreviation: "OSU", leagueId: "cfb" },
    ]);
    // The weight is dropped here, not in the browser.
    expect(JSON.stringify(body)).not.toContain("logos");
  });

  it("ESPN UNREACHABLE → [] and 200, never an error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ENOTFOUND")) as unknown as typeof fetch;
    const res = await teamsGET(req("/api/matchups/teams?league=nfl"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("ESPN returns 500 → [] and 200", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    expect(await (await teamsGET(req("/api/matchups/teams?league=nfl"))).json()).toEqual([]);
  });

  it("ESPN CHANGES SHAPE → [], not a crash", async () => {
    // The failure this design actually expects: an unofficial endpoint quietly
    // returning something else one morning.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { teams: ["Ohio State"] } }),
    }) as unknown as typeof fetch;
    expect(await (await teamsGET(req("/api/matchups/teams?league=nfl"))).json()).toEqual([]);
  });

  it("an unknown league is refused WITHOUT calling ESPN", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    expect(await (await teamsGET(req("/api/matchups/teams?league=cricket"))).json()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("asks ESPN for the FULL list", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = spy as unknown as typeof fetch;
    await teamsGET(req("/api/matchups/teams?league=cfb"));
    expect(String(spy.mock.calls[0][0])).toContain("limit=1000");
    expect(String(spy.mock.calls[0][0])).toContain("college-football");
  });
});

describe("GET /api/matchups/schedule", () => {
  it("normalizes events, reading away/home from homeAway", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            id: "401858432",
            date: "2026-09-05T16:30Z",
            competitions: [
              {
                neutralSite: false,
                competitors: [
                  { homeAway: "home", team: { displayName: "Ohio State Buckeyes" } },
                  { homeAway: "away", team: { displayName: "Ball State Cardinals" } },
                ],
              },
            ],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    expect(await (await scheduleGET(req("/api/matchups/schedule?league=cfb&teamId=194"))).json()).toEqual([
      {
        espnEventId: "401858432",
        away: "Ball State Cardinals",
        home: "Ohio State Buckeyes",
        startsAt: "2026-09-05T16:30Z",
        neutralSite: false,
      },
    ]);
  });

  it("ESPN unreachable → [] and 200", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    const res = await scheduleGET(req("/api/matchups/schedule?league=cfb&teamId=194"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("a missing teamId is refused WITHOUT calling ESPN", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    expect(await (await scheduleGET(req("/api/matchups/schedule?league=cfb"))).json()).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
