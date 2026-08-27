import { describe, it, expect } from "vitest";
import {
  MATCHUP_LEAGUES,
  leagueById,
  normalizeSchedule,
  normalizeTeams,
  scheduleUrl,
  searchTeams,
  teamsUrl,
  upcomingFirst,
  type MatchupTeam,
} from "./matchupApi";
import fixture from "./espnFixture.test-fixture.json";

/**
 * The matchup lookup's pure half.
 *
 * ── The fixtures are REAL ESPN responses, trimmed ───────────────────────────
 * `espnFixture.test-fixture.json` was captured from live calls to
 * `site.api.espn.com` — five college teams and three Ohio State events, with
 * the fields these functions read and nothing else. Hand-written fixtures would
 * test the normalizers against my own idea of the shape, which is exactly the
 * assumption worth not making against an undocumented API.
 *
 * What that does NOT buy: protection from ESPN changing. Nothing can, and the
 * design answer is that every path fails to empty and manual entry is the base
 * case.
 */

const TEAMS = normalizeTeams(fixture.teams, "cfb");

describe("normalizeTeams", () => {
  it("flattens sports→leagues→teams→team and keeps the three searchable names", () => {
    expect(TEAMS).toHaveLength(5);
    const osu = TEAMS.find((t) => t.id === "194");
    expect(osu).toEqual({
      id: "194",
      displayName: "Ohio State Buckeyes",
      shortName: "Ohio State",
      abbreviation: "OSU",
      leagueId: "cfb",
    });
  });

  it("drops a team with no id or no name rather than defaulting one", () => {
    // A team with no id cannot be scheduled and one with no name cannot be
    // searched, so neither is worth a row. Defaulting would put an unusable
    // entry in the list that looks like a real one.
    const raw = {
      sports: [
        {
          leagues: [
            {
              teams: [
                { team: { id: "1", displayName: "Real" } },
                { team: { displayName: "No id" } },
                { team: { id: "2" } },
                { notATeam: true },
              ],
            },
          ],
        },
      ],
    };
    expect(normalizeTeams(raw, "nfl").map((t) => t.displayName)).toEqual(["Real"]);
  });

  it("returns [] for junk instead of throwing", () => {
    // The whole failure posture: an unofficial API that changes shape must
    // produce an empty search box, never a crash on a working manual form.
    for (const junk of [null, undefined, {}, { sports: "nope" }, [], 42]) {
      expect(normalizeTeams(junk, "nfl")).toEqual([]);
    }
  });
});

describe("normalizeSchedule", () => {
  const games = normalizeSchedule(fixture.schedule);

  it("reads away/home from homeAway, not from array order", () => {
    // ESPN's competitor array is not reliably ordered, and "competitors[0] is
    // away" is the assumption that works until it doesn't. In this real
    // fixture the HOME team is listed first.
    const g = games.find((x) => x.espnEventId === "401858432")!;
    expect(g.away).toBe("Ball State Cardinals");
    expect(g.home).toBe("Ohio State Buckeyes");
    expect(fixture.schedule.events[0].competitions[0].competitors[0].homeAway).toBe("home");
  });

  it("carries the event id and the raw ISO instant", () => {
    const g = games.find((x) => x.espnEventId === "401858432")!;
    expect(g.startsAt).toBe("2026-09-05T16:30Z");
    expect(Number.isFinite(new Date(g.startsAt).getTime())).toBe(true);
  });

  it("drops a one-sided contest — you cannot pick a winner in it", () => {
    const raw = {
      events: [
        {
          id: "1",
          date: "2026-09-05T16:30Z",
          competitions: [{ competitors: [{ homeAway: "home", team: { displayName: "Only" } }] }],
        },
      ],
    };
    expect(normalizeSchedule(raw)).toEqual([]);
  });

  it("returns [] for junk instead of throwing", () => {
    for (const junk of [null, undefined, {}, { events: "nope" }, 7]) {
      expect(normalizeSchedule(junk)).toEqual([]);
    }
  });
});

describe("searchTeams — fuzzy across all three names", () => {
  const names = (q: string) => searchTeams(TEAMS, q).map((t) => t.displayName);

  it("matches the ABBREVIATION exactly, and ranks it first", () => {
    expect(names("OSU")[0]).toBe("Ohio State Buckeyes");
    expect(names("MICH")[0]).toBe("Michigan Wolverines");
  });

  it("matches the SHORT name", () => {
    expect(names("Ohio State")[0]).toBe("Ohio State Buckeyes");
  });

  it("matches the DISPLAY name", () => {
    expect(names("Ohio State Buckeyes")[0]).toBe("Ohio State Buckeyes");
  });

  it("a prefix returns both Ohios, and does not silently pick one", () => {
    // "Ohio" is genuinely ambiguous — Ohio State and Ohio Bobcats are different
    // schools. The search must offer both rather than guess.
    const out = names("Ohio");
    expect(out).toContain("Ohio State Buckeyes");
    expect(out).toContain("Ohio Bobcats");
  });

  it("ignores case and punctuation", () => {
    expect(names("ohio st.")).toContain("Ohio State Buckeyes");
    expect(names("MICHIGAN")).toContain("Michigan Wolverines");
  });

  it("finds a mid-name word — 'state' reaches three different schools", () => {
    const out = names("State");
    expect(out).toContain("Ohio State Buckeyes");
    expect(out).toContain("Michigan State Spartans");
    expect(out).toContain("Iowa State Cyclones");
  });

  it("one character searches nothing — it would match most of college football", () => {
    expect(names("O")).toEqual([]);
    expect(names("")).toEqual([]);
  });

  it("is PURE — it cannot reach the network, which is what makes typing free", () => {
    // The load-bearing property behind "only selecting a game hits the
    // network". Asserted structurally: the function is synchronous and returns
    // an array, so there is no request it could be awaiting.
    const out = searchTeams(TEAMS, "Ohio");
    expect(Array.isArray(out)).toBe(true);
    expect(out).not.toBeInstanceOf(Promise);
  });
});

describe("upcomingFirst", () => {
  const games = normalizeSchedule(fixture.schedule);

  it("orders future games soonest-first, against an INJECTED clock", () => {
    // The clock is a parameter so this does not start failing in September.
    const before = new Date("2026-09-01T00:00Z").getTime();
    expect(upcomingFirst(games, before).map((g) => g.espnEventId)).toEqual([
      "401858432",
      "401856682",
      "401858454",
    ]);
  });

  it("falls back to recent PAST games when the season is over", () => {
    // An empty list reads as "this team doesn't exist", which is a worse answer
    // than "here is what they last played".
    const after = new Date("2027-01-01T00:00Z").getTime();
    const out = upcomingFirst(games, after);
    expect(out).toHaveLength(3);
    expect(out[0].espnEventId).toBe("401858454"); // most recent first
  });

  it("drops an unparseable date rather than sorting NaN", () => {
    const withJunk = [...games, { espnEventId: "x", away: "A", home: "B", startsAt: "soon", neutralSite: false }];
    expect(upcomingFirst(withJunk, 0).map((g) => g.espnEventId)).not.toContain("x");
  });
});

describe("leagues are config", () => {
  it("ships NFL and college football, and both resolve", () => {
    expect(MATCHUP_LEAGUES.map((l) => l.id)).toEqual(["nfl", "cfb"]);
    expect(leagueById("cfb")?.espnPath).toBe("football/college-football");
    expect(leagueById("nope")).toBeUndefined();
  });

  it("the teams URL asks for the FULL list, not ESPN's default page", () => {
    // Without `limit`, ESPN pages at 50 and the college index arrives silently
    // short — which reads in the UI as "that team doesn't exist" rather than as
    // a truncated fetch.
    expect(teamsUrl(leagueById("cfb")!)).toContain("limit=1000");
  });

  it("the schedule URL encodes the team id", () => {
    expect(scheduleUrl(leagueById("nfl")!, "22")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/22/schedule"
    );
  });
});

describe("the index a caller holds", () => {
  it("is small enough to search on every keystroke", () => {
    // Four short strings per team. The reason the 1.85 MB college payload is
    // normalized server-side rather than shipped.
    const one: MatchupTeam = TEAMS[0];
    expect(Object.keys(one).sort()).toEqual([
      "abbreviation",
      "displayName",
      "id",
      "leagueId",
      "shortName",
    ]);
  });
});
