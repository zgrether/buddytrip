import { describe, it, expect } from "vitest";
import {
  MATCHUP_LEAGUES,
  formatKickoff,
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
      "401858465", // the TBD one still sorts by its date, which is real
    ]);
  });

  it("falls back to recent PAST games when the season is over", () => {
    // An empty list reads as "this team doesn't exist", which is a worse answer
    // than "here is what they last played".
    const after = new Date("2027-01-01T00:00Z").getTime();
    const out = upcomingFirst(games, after);
    expect(out).toHaveLength(4);
    expect(out[0].espnEventId).toBe("401858465"); // most recent first
  });

  it("drops an unparseable date rather than sorting NaN", () => {
    const withJunk = [
      ...games,
      { espnEventId: "x", away: "A", home: "B", startsAt: "soon", neutralSite: false, startTimeKnown: true },
    ];
    expect(upcomingFirst(withJunk, 0).map((g) => g.espnEventId)).not.toContain("x");
  });
});

describe("a to-be-scheduled kickoff", () => {
  const games = normalizeSchedule(fixture.schedule);
  const tbd = games.find((g) => g.espnEventId === "401858465")!;
  const known = games.find((g) => g.espnEventId === "401858432")!;

  it("is read from ESPN's timeValid flag, not guessed from the clock", () => {
    expect(known.startTimeKnown).toBe(true);
    expect(tbd.startTimeKnown).toBe(false);
  });

  it("does NOT arrive as midnight UTC — which is why a heuristic was wrong", () => {
    // The real fixture: a TBD game is midnight US EASTERN expressed in UTC.
    // 04:00Z in September, and 05:00Z once the DST change lands in November.
    // A "is it local midnight?" test would have fired only for viewers in
    // Eastern and shown everyone else a confident, wrong evening time.
    expect(tbd.startsAt).toBe("2026-09-26T04:00Z");
    expect(tbd.startsAt.endsWith("00:00Z")).toBe(false);
  });

  it("renders as TBD, keeping the DATE — that part is real", () => {
    const out = formatKickoff(tbd.startsAt, tbd.startTimeKnown);
    expect(out).toContain("Sep 26");
    expect(out).toContain("TBD");
    // ...and specifically not a time.
    expect(out).not.toMatch(/\d:\d\d/);
  });

  it("a known kickoff still shows its time", () => {
    const out = formatKickoff(known.startsAt, known.startTimeKnown);
    expect(out).not.toContain("TBD");
    expect(out).toMatch(/\d:\d\d/);
  });

  it("a MISSING flag means known, not TBD", () => {
    // The flag marks the exception. Defaulting to TBD when a field goes missing
    // would hide every real kickoff behind a shape change — failing loud in the
    // wrong direction.
    const raw = {
      events: [
        {
          id: "1",
          date: "2026-09-05T16:30Z",
          competitions: [
            {
              competitors: [
                { homeAway: "away", team: { displayName: "A" } },
                { homeAway: "home", team: { displayName: "B" } },
              ],
            },
          ],
        },
      ],
    };
    expect(normalizeSchedule(raw)[0].startTimeKnown).toBe(true);
  });
});

describe("formatKickoff", () => {
  // A fixed instant, formatted in a fixed zone, so this does not depend on the
  // runner's machine or the day the suite runs.
  const at = (iso: string) => formatKickoff(iso);

  it("carries the DATE, not just a weekday", () => {
    // The whole reason it changed: this returns the next several games, spread
    // over WEEKS. Three rows reading "Sat" name three different Saturdays and
    // nothing tells them apart.
    const sep = at("2026-09-05T16:30Z");
    const oct = at("2026-10-03T16:30Z");
    expect(sep).not.toBe(oct);
    expect(sep).toMatch(/Sep/);
    expect(oct).toMatch(/Oct/);
  });

  it("keeps the weekday — football is thought about in weekdays", () => {
    expect(at("2026-09-05T16:30Z")).toMatch(/^(Sat|Fri|Sun)/);
  });

  it("is SHORT — it lands in the slate's Game time field on every row", () => {
    // It competes for width with the matchup itself on a sixteen-row list.
    expect(at("2026-09-05T16:30Z").length).toBeLessThanOrEqual(20);
  });

  it("compresses am/pm to one letter, the way the slate writes times", () => {
    expect(at("2026-09-05T16:30Z")).toMatch(/\d(a|p)$/);
    expect(at("2026-09-05T16:30Z")).not.toMatch(/AM|PM/);
  });

  it("an unparseable instant is empty, not 'Invalid Date'", () => {
    expect(at("not-a-date")).toBe("");
    expect(at("")).toBe("");
  });
});

describe("leagues are config", () => {
  it("ships NFL, CFB and MLB, and all three resolve", () => {
    expect(MATCHUP_LEAGUES.map((l) => l.id)).toEqual(["nfl", "cfb", "mlb"]);
    expect(MATCHUP_LEAGUES.map((l) => l.label)).toEqual(["NFL", "CFB", "MLB"]);
    expect(leagueById("nope")).toBeUndefined();
  });

  it("pins every ESPN PATH, because a typo here fails to SILENCE", () => {
    /**
     * The module's stated contract is that it "fails to EMPTY, never to an
     * error the surface cannot continue past" — a defence against ESPN changing
     * shape, and the reason a wrong path is the most dangerous edit in this
     * file. A bad segment 404s, the route returns nothing, and the search shows
     * "no teams" with no error anywhere. It reads as an out-of-season league.
     *
     * So the paths are asserted exactly, per league, rather than by shape. Each
     * was fetched live on 2026-08-30 while adding MLB.
     */
    const paths = Object.fromEntries(MATCHUP_LEAGUES.map((l) => [l.id, l.espnPath]));
    expect(paths).toEqual({
      nfl: "football/nfl",
      cfb: "football/college-football",
      mlb: "baseball/mlb",
    });
  });

  it("keeps the id stable while the LABEL changes — cfb was renamed", () => {
    /**
     * "College Football" became "CFB": a display-string change, made because
     * these are toggles in a row on a 390px screen and one label three times
     * the length of its neighbours sets the width of the row.
     *
     * The `id` is the URL parameter, the cache key and what `leagueById`
     * matches, so it must NOT have moved with it. Asserted together, because
     * the failure mode is renaming both and silently orphaning every stored
     * slate and cached index.
     */
    const cfb = leagueById("cfb");
    expect(cfb?.label).toBe("CFB");
    expect(cfb?.espnPath).toBe("football/college-football");
  });

  it("labels are all ABBREVIATIONS — a set, not one heading and two chips", () => {
    /**
     * The rename as a rule rather than a one-off, so a fourth league does not
     * arrive as "National Basketball Association".
     *
     * NOT a width guard, and the difference matters: measured at 390px the
     * long label did NOT overflow — 200px of a 330px row, one line — so a test
     * claiming it breaks the layout would be asserting something false. What it
     * did was take half the used width for one of three equal choices. This
     * pins the CONVENTION, which is the thing actually being kept.
     */
    for (const l of MATCHUP_LEAGUES) {
      expect(l.label.length, l.id + " label is not an abbreviation").toBeLessThanOrEqual(4);
    }
  });

  it("the teams URL asks for the FULL list, not ESPN's default page", () => {
    // Without `limit`, ESPN pages at 50 and the college index arrives silently
    // short — which reads in the UI as "that team doesn't exist" rather than as
    // a truncated fetch.
    expect(teamsUrl(leagueById("cfb")!)).toContain("limit=1000");
  });

  it("the schedule URL encodes the team id", () => {
    expect(scheduleUrl(leagueById("nfl")!, "22")).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/22/schedule?seasontype=2"
    );
  });

  it("asks EVERY league for the regular season, baseball included", () => {
    /**
     * `seasontype=2` exists because the NFL's default in August is the
     * PRESEASON, which returned only games in the past. MLB was measured rather
     * than assumed when it was added (2026-08-30): its default is already
     * seasontype 2, 163 events, so the parameter is redundant there rather than
     * wrong — and sending it uniformly is what keeps this one URL builder
     * instead of a per-league branch.
     *
     * Asserted across the whole list so a league added later cannot quietly
     * miss it.
     */
    for (const l of MATCHUP_LEAGUES) {
      expect(scheduleUrl(l, "1"), l.id).toContain("seasontype=2");
    }
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
