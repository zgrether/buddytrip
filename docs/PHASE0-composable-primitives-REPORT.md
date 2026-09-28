# Phase 0 report: composable primitives

**Findings report, as of `main` at `32b52300`, delivered 2026-09-22.**

**Provenance.** This is Claude Code's Phase 0 findings report, relayed by Zach in chat and
committed here so it lives beside the build plan. The brief that commissioned it is
`PHASE0-composable-primitives.md`. `BUILD-PLAN-composable-competitions.md` is built on
this report.

**This is a historical snapshot, not current behaviour.** Several findings below have since
been fixed — F1 in PR 0, the head-to-head guards in PR 4, the convention collapse in PR 2
and 3b, among others. **Per the code-versus-documentation rule, verify against `src/` and
`supabase/migrations/` before relying on any line here.**

---

Only the matchup engine is plug-and-play today. The points roll-up works but guesses in
places, and the bracket, rack, non-golf Matches and the cup's own ending are coupled enough
that Circles can't lean on them yet. Along the way I found one live correctness bug
(double-elimination brackets end early) and three of the brief's premises that don't hold as
written.

**How to read the confidence marks:**

- **R:** code reading only, by one of four parallel read-only sweeps.
- **R✓:** code reading that I then re-checked myself at the lines cited.
- **D:** production data, from read-only SQL.
- **RUN:** needs a run to confirm.

There are no open PRs to check against. Where a finding is already an instance of an open
issue, I name it.

## Premises in the brief that didn't hold

**#1381's fix does not make rows declare their convention. It infers it from which column is
null.** `rowConvention` (`competitionLeaderboard.ts:62`) returns "positions" when every row
has a position, "points" when none do, and "mixed" otherwise. That result is checked against
a direction each scoring path hardcodes. No column records a convention or a direction
(`033:62-71`). This is far better than `position ?? raw_score`, but it's inference from
column nullness, not a declaration. **R✓**

**Rack's `if (!tripId || !competitionId) return;` (`RackGameView.tsx:537`) sits inside
`startRack()`, the create handler, not the view.** The view-level gate is `:271`
(`!!competitionId && teamIds.length >= 2`). It reads the trip's competition
(`competitions.getByTrip`, `:155`), not the game's own `competition_id`, and the file admits
this at `:514`. So a standalone rack game on a trip that has a cup passes the client gate,
and the server then writes nothing (`rackNStack.ts:54`). **R, needs a RUN.**

**The pick'em `matchState` fix does hold on `main`.** `upside` is now a per-unit function
(`pickemMatchCard.ts:62-78`), and `matchPlay.ts:311-324` sums only the units still unplayed
at each step. **R**

## ⚠ The live finding (F1): double elimination is posted as single elimination

**Two different resolvers.** `pickWinner` picks the double-elimination resolver
(`games.ts:699`). The only finalize path, `deriveBracketPlacements`
(`bracketResults.ts:75,83`), always calls `resolveDraw` → `drawComplete` →
`bracketPlacements`.

**What that resolver does.** `resolveDraw` drops lower/final rows
(`bracketAdvance.ts:147, 237`). So `drawComplete` turns true once main alone is decided, and
placements come from main only. **R✓**

**It has already happened, on a test game.** Production's one double-elimination bracket
("Double Elim Test", BBMI Test Cup, created 08-23) is complete. It was posted with 4 of 15
matches undecided: lower rounds 3 and 4, and both grand-final rows. Its results are
single-elimination placements. Seeds 8 and 1 were still alive in the lower bracket. **D**

**No test covers it.** No server test finalizes a double bracket. Every double-elimination
test lives in `src/lib`, and the client preview uses the right resolver
(`NonGolfGameView.tsx:829`). Its comment says "the SAME three functions the server runs"
(`:818`), which is false for double elimination. **R✓**

The brief says to open nothing, so this is reported here only. By `CLAUDE.md`'s
capture-at-source rule, it's the one finding I'd want filed first when this gets sorted.

## 1 · Structures

| Structure | Inputs, and read vs inferred | Container it reads | Other sources? | Reused or duplicated |
|---|---|---|---|---|
| **Matchup engine** (`matchState`, `matchPlay.ts:290`) | Per-unit results. Direction is hardcoded low-wins per hole (`:103`). Round length is inferred: `strokeIndex?.length \|\| holeCount \|\| HOLES` (`:69`), and a missing hole count defaults to 18. **R** | None. It "has zero awareness of which source it came from" (`:30`). | Yes. Pick'em already drives it through a weight function (`:288-294`), and outcome mode feeds it from `match_hole_outcomes`. **R** | Also done in `pickemBoard.matchStanding` (`:256`, its own clinch logic) and in rack's slot leader. |
| **Golf match game** | `score_entries` or `match_hole_outcomes`. A missing handicap plays as scratch (`hcap ?? 0`). A side's type is a string check (`matchAwards.ts:96`). **R** | `twoTeams = !!gameCompId && teams.length === 2` (`MatchGameView.tsx:586`). The team award is gated on the shape of the points distribution (`server/lib/matchPlay.ts:265`). **R** | Yes, through outcome rows. | Four match cards: shared `MatchCard.tsx:212`, `BracketBoard.tsx:531` (local, **R✓**), `PickemMatchCard.tsx:331`, `MatchesScoreboard.tsx:82`. Also four copies of the side→team resolver (one commented "duplicated rather than shared") and five side-colour resolvers. **R** |
| **Non-golf Matches** | A declared `a_win`/`b_win`/`halve`. `matches.setResult` never checks the game's format (it selects only `id`, `status`, `corrections_open`, `scoring_enabled`), so it can mark a golf match row `complete`. The next recompute then skips that row as frozen. **R✓** (whether it's reachable, **RUN**) | `MatchesBuilder` takes `[a, b] = teams` (`:69`). Finalize is gated only on `competition_id`, so a standalone Matches game completes with no results written. **R** | Yes (the result is declared). | Own scoreboard and card. |
| **Rack** | `score_entries` (users only) plus rosters. Direction is hardcoded (ascending sort, `rackNStack.ts:132`). The 18 is hardcoded in projection (`:63`). **R** | Two-team by construction. Three different rules pick "the two teams": server finalize takes the lowest two ids among assigned teams (`:78`), the live projection takes the lowest two among the game's participants (`liveProjection.ts:392`), and the client takes `created_at` order (`RackGameView.tsx:209`). With three teams they can pick different pairs. **R, needs a RUN.** | No. | Its own resolver. |
| **Bracket** | Picks only, an explicit winner seed (`games.ts:641`). Entrants must be `users` rows, 1–2 per entrant (`112:79`, `games.ts:1698`). The team is inferred from the first member (`configDraft.ts:827`). Single vs double is decided two ways: from config on the client (`elimination ?? "single"`) and from the shape of the draw on the server (`games.ts:698`). **R** | A trip is required (`trip_id NOT NULL`, RLS). A cup is effectively required: a null team is refused (`games.ts:1811`). Not gated by scoring model. **R** | The NCAA test fails on identity and write path, not on size: entrants must be users with a non-null cup team, results come only from `pickWinner` by owner, co-admin or delegate, and there's no import path. Size fits (64 entrants, 128 draw rows). Seeding is pool order, always the standard 1-vs-N layout. **R** | The duplications listed below. |
| **Points roll-up** (`computeCompetitionLeaderboard`) | Game results by inferred convention (see premise 1). `scoring_model ?? "match_play"` with `compRes.error` never checked (`:205`), so a failed read silently selects match-play arms. The bracket path still does the fold #1381 removed, `r.position ?? r.raw_score ?? 0` (`:390`): harmless today, but a null/null row would rank ahead of 1st. **R✓** (`:205`), **R** (`:390`) | Branches on `scoring_model`, then bracket / pick'em / manual / per-match / placement, keyed on the distribution's shape (`:453–671`). **R** | It reads `game_results`, so anything that writes a declared row could feed it. | Clinch arithmetic is shared (`competitionPlacement.ts`). |
| **Stroke / Stableford / skins** | Direction is declared: `rankingDirection` (`strokePlay.ts:70`). A missing par is treated as 0 (`:157`), which inflates Stableford (**RUN**). Skins with an empty schema assumes 18 holes. **R** | Standalone writes user rows only. **R** | Yes (scores in). | One ranking function for all three. |
| **Pick'em** | `use_confidence ?? true`, `roll_up ?? "team_totals"`, `pointsMode ?? false` (`pickemResults.ts:224-226`). Resolution flips on all three, so a standalone game defaults to match-play resolution. **R** | A points cup overrides `roll_up`. Standalone makes no awards. **R** | It is the one prediction source. | Its own standing and clinch logic, parallel to `matchState`. |
| **Standings over time** | Doesn't exist. `circle_events` is a 4-column stub with no reader. `series` was dropped (`024`). "One competition per trip" is an `if`, with no UNIQUE constraint. `defending_team_id` links to nothing earlier. **R** | n/a | n/a | n/a |

**The NCAA test in detail, and the bracket's internal duplication.** Entrant identity, the
write path, permissions and seeding source would all have to change; the limits are at
`112:79`, `games.ts:1698/1811/643/1700`. Inside the bracket code: "loser of" is written five
times, positions are computed twice, and `resolveDoubleDraw` still has the `!` "hole" that
`resolveDraw` fixed (`bracketDoubleAdvance.ts:269`). **R**

## 2 · Compatibility

The sweep found 24 rules. Only four are checked by the server or the database against the
game's format or team shape: format ↔ scoring model (#1402), the set of non-golf format
values (CHECK in migration 170), split vs match-by-match payout (#1381), and the course lock.
Every rule that depends on how many teams a cup has lives in the UI or in how the compute
code happens to be written.

| Rule | Where it lives | Declared? | Fails silently |
|---|---|---|---|
| Format ↔ scoring model | catalog + `games.create` + menu | yes | none inside a cup; a standalone game skips it |
| Match-play cup has 2 teams | set at creation only (`competitions.ts:362`); team seeding there is best-effort, so it can end at 0 teams | no | ⚠ `teams.create`/`delete` have no check (**R✓**) |
| Rack needs 2 teams | compute (`rackNStack.ts:78-80`) | no | ⚠ 1 team: writes nothing, still finalizes. 3 teams: the third is skipped and gets a NaN row (**R✓**) |
| Matches needs 2 teams | `MatchesBuilder` only | no | ⚠ the third team reads as a scored 0 |
| Pay per match vs split by place | `refuseSplitOnPerMatchGame` | yes (predicate) | ⚠ `games.create` accepts any split with no check. Rack isn't in `awardsPerMatch` |
| Go-live readiness | implemented twice | yes ×2 | ⚠ They disagree for Matches. The SQL `ELSE` arm (`187:1167`) checks only that a points column is set; TS has a Matches arm (`gameReadiness.ts:100`). So going live via Save may be possible with 0 matches paired. **R✓, needs a RUN.** Instance of #1332 |
| 2v2 partners on the same team | `matches.setPairings` (no client caller) | no | ⚠ `save_game_config` never reads `team_assignments`, and the award credits the first member's team |
| The two sides are on different teams | nowhere | no | ⚠ a same-team match pays that team the full value (`matchAwards.ts:49-63`) |
| Side with no team scores nothing | compute | no | ⚠ the live projection credits the teamed side while finalize pays nothing, so the two diverge |
| Course locked once scored | RPC (every score shape) and `applyCourse` (`score_entries` only) | yes ×2 | ⚠ `applyCourse` is blind to outcome-mode and skins scores, and reads a failed count as 0 (**R✓**). `CLAUDE.md` #27 again |
| Roster locks once the cup starts | `game_started` view | yes | ⚠ manual and bracket results aren't in the view, so teams can still be deleted |
| Glorious holes ↔ format | compute guard; the RPC doesn't check `compatibleModifiers` | mixed | stored on any format, inert only by construction |
| Entry mode ↔ format | a CHECK on the values, not tied to the game type | no | `outcome` on a non-match game reads as "configured" |
| **Bracket pick permission (F2)** | guard allows owner, co-admin or delegate (`games.ts:643`); RLS allows trip Owner/Organizer only (`112:147`); checked with `assertNoError` only | yes ×2 | ⚠ A delegate or co-admin who is only a trip Member may get a silent 0-row update. **R✓, needs a RUN** |
| Clinch push ↔ scoring model | nowhere: `notifyCupClinchedIfDecided` is called for any cup (`games.ts:1383`) and has no scoring-model check (**R✓**) | no | ⚠ a points cup that crosses half would send a "clinched" push no screen shows (**RUN**) |

## 3 · Outcomes

| Structure | Winner and direction | Decided vs final | Ties | Tiebreak | Open-ended? |
|---|---|---|---|---|---|
| Matchup engine | per-hole low-wins, hardcoded | separate: close-out vs `over`; the ceiling is summed per unplayed unit, so no terminal-only use remains | halve is declared | none (halve) | no; needs a finite hole count |
| Match card UI | n/a | n/a | ⚠ "AS" on an unplayed match looks the same as "AS" as a result. `square = st.leader === null` (`MatchCard.tsx:275`) makes both sides grey "AS" at 0 holes (**R✓**). The data does separate them (`margin = "AS"` only when `over`), and pick'em separates them (`not-started`). | n/a | n/a |
| Rack | net-to-par ascending, hardcoded | ⚠ finalize doesn't check completeness (`games.ts:1250`); `GAME_FORMATS.md:89` says "all-units-complete" | slot ties split ½ | pairing order only | no |
| Bracket | explicit pick; no direction assumed anywhere | `championSeed` is separate from `drawComplete`; nothing clinches early | cannot tie | none: everyone eliminated in the same round shares a place | not expressible (fixed draw) |
| Roll-up | direction hardcoded per arm (`low_wins`/`high_wins` literals), corrected only by `reconcileConvention` | clinch = `pointsToClinch ≤ 0`, and the pool counts never-started games; `isCupComplete` is inferred, match-play cups only | cup tie is an absence: no tiebreak, so `isCupComplete` stays false forever, except a defending team keeps the cup at exactly half | none | ⚠ see below |
| Stroke family | declared (`rankingDirection`) | n/a | shared position (1, 2, 2, 4) | output order only | n/a |
| ⚠ Stroke team total | raw sum across qualified players (`strokePlay.ts:441`) | n/a | n/a | n/a | teams with different finisher counts compare unequally, in opposite directions for Traditional vs Stableford |
| Pick'em | `margin > 0`, `Math.max`, `orderByTotal` hardcoded high | clinch kept apart from final | level = 0.5 each | sort stability over an unordered teams read | an empty slate reads `final` (**RUN**) |

**N-team clinch.** The threshold is ">half" whatever the team count
(`competitionPlacement.ts:151`). For three or more teams, that isn't when the other teams are
mathematically out. **R**

**Open-ended cups are not expressible.** `competitions.status` (upcoming/active/completed)
exists, but nothing writes `completed`, and `competitions.ts:390` says so. A cup's end is
only ever inferred, and only for match play. A points cup has no end state and no winner
signal in the UI. A cup that never finalizes just stays "clinched · N remain" or undecided.
So today, open-ended can only be faked by never finalizing. That's principle 3's failure
exactly. **R**

**Empty vs unknown, still present:**

- The pick'em points-cup arm returns `[]` for a game with no points configured, `[]` is
  truthy, so the grid shows "1st · 0 pts" (**RUN**).
- Every team starts at 0, so "played nothing" and "lost everything" look the same.
- A team with no sheets has upside 0 and can read as clinched against. The no-sheet guard
  exists per match, not per team (**RUN**).

## 4 · The dimensions compatibility actually varies on (as found in code)

- **Sidedness:** two-sided vs N-way
- **Team count:** 0, 1, 2 or N, checked as `=== 2`, `>= 2` or `<= 2` in different places
- **Scoring model**
- **Result strategy:** the game type's own, or `competition_format` for manual types
- **Result source:** scores, outcome rows, skins outcomes, a declared match result, pick'em
  slate results, entered placements, bracket picks
- **Entry mode:** score or outcome
- **Payout shape** (per match or split by place), and whether a total is set
- **Scoring unit:** user, play_group, team or entrant
- **Side size:** 1 or 2
- **Direction:** low or high; declared only in the stroke family
- **Requires a competition:** rack, Matches, scramble and bracket in practice
- **Requires a course or scorecard**
- **Unit count:** often a silent default of 18
- **Revaluable after scores:** glorious holes, 18-hole only
- **Lifecycle axes:** `status`, `scoring_enabled`, `pairings_published_at`,
  `corrections_open`
- **Started-ness:** the `game_started` view, which misses manual and bracket results

**Declared today:** scoring model and entry-mode values. **Inferred or implicit:** team
count, direction, result convention, and whether a competition is required.

## 5 · #1304's held decisions: what the evidence implies (not decided)

**A match game in a cup without exactly two teams.** The code has three picker paths, not
two (`MatchGameView.tsx:2401-2406`): the team rosters when there are exactly two teams, else
everyone assigned in the cup, else the whole crew. So `GAME_FORMATS.md:157`'s "falls back to
the whole trip crew" is true only when the cup has no rosters. The non-two-team cup path is
not the standalone path. It gates go-live on points, writes team rows for every team, skips
roster validation, and never checks that the two sides are on different teams. The evidence
implies the path that is actually clean is standalone, which is the one a decoupled model
makes primary. A cup with some other team count works as neither case: it's a
half-supported third state whose failures are silent. **R**

**`teams.delete` below two on a match-play cup.** Every consequence is silent: all matches
become intra-team and pay that team the full value, rack writes nothing but finalizes, the
summary drops its two-team race layout, and placement capacity falls to 1. The only guard is
the roster lock, which misses manual and bracket results. The evidence implies delete is a
door with no check on the other side of it. **R**

**Non-golf Matches in an N-team cup.** The UI can only pair the first two teams. Finalize
writes a 0 row for the third team, which then reads as a scored 0: empty rendered as a
result. The server accepts any pairing by direct call, and `setResult` accepts any format.
The evidence implies the two-team assumption is real and enforced only by the builder. **R**,
the board's rendering needs a **RUN**.

## 6 · Ranking

**Plug-and-play now:**

- The matchup engine (`matchState`): source-agnostic and already shared by golf and pick'em.
  Its one gap is that direction is hardcoded.
- The stroke-family ranking: direction is declared.
- Placement points (`competitionPlacement`): direction is a parameter.

**Works but needs loosening:**

- The points roll-up: convention is inferred, direction is hardcoded per arm, the clinch
  threshold assumes two teams, and there's no end state.
- Pick'em: resolution depends on defaults, and there's no team-level no-sheet.

**Too coupled for Circles to lean on yet:**

- The bracket: live correctness bug F1, possible permission gap F2, users-only entrants, a
  team is required, results come only from picks, and single-vs-double is read from two
  places.
- Rack: two-team by construction, container read from the trip, three different "which two
  teams" rules.
- Non-golf Matches: `teams[0..1]`, format-agnostic `setResult`, readiness disagreement.
- The cup outcome itself: no declared end, no declared open state, and ties are an absence.

## 7 · Confidence limits

**Established beyond reading:** F1 (production data), the bracket counts, and the #1304
production counts from earlier (**D**).

**Re-checked by me (R✓):** F1's code path, F2's policy vs guard, `setResult`, the "AS" chip,
the unchecked `compRes.error`, the clinch push, the SQL-vs-TS go-live difference,
`applyCourse`, bracket realtime, `rowConvention`, and `BracketBoard:531`.

**Everything else is R, from one sweep each.** This month's record says rung 1 misfires, so
treat those as leads, not facts.

**Needs a RUN:**

- F2
- Matches go-live through Save
- The rack NaN row and three-team pair selection
- The pick'em "1st · 0 pts" grid and team-level clinch against no sheets
- The clinch push on a points cup
- Missing par in Stableford
- The empty pick'em slate reading final
- `setResult` on a golf match
- `MatchCard`'s history strip with out-of-order holes

**Doc vs code, reported and not resolved:**

- `GAME_FORMATS.md:291-293` says double elimination is "still deferred", but it's live code.
- `GAME_FORMATS.md:274/292` list the dropped `live_results` value and say "losers' bracket".
- Migration `127:36` says the if-necessary final's "existence stays derived", but
  `buildDoubleDraw` persists round 2.
- `pickWinner`'s docstring says clearing a pick does not cascade, but the code deletes
  orphaned picks.
- `GAME_FORMATS.md:89` says rack finalizes only when complete; the server doesn't check.
- `CLAUDE.md` #11 says glorious holes are guarded on `game_type_id`; the code also gates on
  `entry_mode`.
- The `StrokeGameView.tsx:457` comment says a match game can't be in a three-team cup;
  nothing enforces that.
- The `useRealtimeGame` comment claims to cover the config-hash tables; the bracket tables
  are excluded.
- Two stale code comments still describe `position ?? raw_score` (`strokePlay.ts:221`,
  `pickemResults.ts:245`).
- My own addition to `GAME_FORMATS` §7 from #1402 is imprecise. It says rack gives slots A/B
  to "the first two team ids". The code sorts by id among teams with assignments, and the
  client uses `created_at` order. I'll correct it when this is sorted.

**Existing issues these findings are instances of:** #1332 (readiness twice), #934 (bracket
rebuild via poll only), #1029, #1120, #1368. Not filed, per the brief.
