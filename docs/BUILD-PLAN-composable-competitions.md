# BUILD PLAN — Composable competitions

**Revision 2, 2026-09-22. Revised in place.** Revision 1 delivered the engine and almost
no way to reach it. This revision adds the two entry points — **creating a competition,
and side games on a trip** — so capability and access land together.

**Built on [`PHASE0-composable-primitives.md`](PHASE0-composable-primitives.md) (the brief)
and its findings, [`PHASE0-composable-primitives-REPORT.md`](PHASE0-composable-primitives-REPORT.md)
(a snapshot as of `32b52300`, not current behaviour), and the rulings settled with Zach.**

> **One version, in the repo, from 2026-09-27.** Until then this plan lived as two copies
> outside the repo: Zach's, and CC's with the rulings it recorded as PRs landed. They
> drifted, which is exactly what a document revised in place exists to prevent. This file
> is Zach's latest copy merged with every ruling CC had recorded: ruling 25's reversal, the
> 6a/6b split, the PR 9 live surface, PR 5's carry-over to PR 7, the `allowedContainers`
> correction and today's PR 6 and PR 7 rulings. **Revise it here, in the PR that makes a
> ruling true or false; there is no other copy.**

---

## What this is, and what it is not

**A build plan, not a design document.** Every ruling maps to the code it changes and to a
test that fails if the rule is broken. **The rule lives in the test.** A ruling with no
enforcing test has not been built, whatever the prose says.

**The failure this exists to avoid is `COMPETITION_ENGINE.md`** — a design written down,
never built, and later cited as current behaviour.

**And the failure revision 1 nearly repeated is the practice round.** Standalone games
already exist in code but **not one exists in production** — `#1254` measured zero of forty
games with a null `competition_id`, against `CLAUDE.md` #20's claim of 40%. **The capability
has been there all along and nobody has ever reached it**, because it is reachable by URL
only. The
practice round failed because it lived somewhere nobody would find it; JD built a fake
three-team cup because the cup was the only place a game was visible. **The engine was
never the blocker. Access was.** This plan builds both.

**What it delivers:** teamless competitions, side games visible on a trip, match games in
points cups, correct standings, safe roster changes — reachable from the trip.

**What it does not deliver:** creating a game from the home page with no trip. Every game
still sits on a trip, so that waits on the Circle migration.

---

## The three principles

**1 · Plug-and-play, with limits the model knows.** The limits are declared data the
server checks — not UI conditionals, comments, or compute-by-construction.

**2 · Every container resolves an outcome, and direction is declared — on the result rows,
not on the format.** Nothing assumes high wins, and nothing infers direction from the arm
it happens to be in.

**3 · Open-ended is a declared outcome, not a missing one.** Empty and unknown never render
the same.

---

## The rulings

**Settled. A PR that finds one wrong stops and reports — it does not reinterpret.**

### Competition types

1. **A game needs no competition.** Side games are the primary path, not a fallback.
2. **Head to head** (the Ryder cup): exactly two teams; match formats and rack only.
3. **Head to head:** every participant is rostered on one of its two teams.
4. **Head to head owns *cup* outcome and *cup* clinch.** No other type fires a cup clinch.
   **This is about the competition being decided, not about a match being decided.** A
   pick'em head-to-head that can no longer change is a *match* clinch and is untouched by
   this ruling — the same distinction as game projection versus cup outcome. `#1317` is
   therefore duplication cleanup, not a second clinch owner.
5. **Points race** (the points cup): any number of units. Teams optional, including none.

### Who scores

6. **The scoring unit is the participant's team if they have one, otherwise the
   participant.**
7. **Head-to-head result:** the winning side's unit gets the game's points; a halve splits
   them.
8. **Ranked result:** points by placement.
9. **Empty side:** forfeit. The present side wins.

### Where rules live

10. **Pairings are unrestricted in the backend**, same-team included. The picker enforces
    policy.
11. **Structural rules are refused by the server. Policy lives in the picker.**
12. **Rack is a head-to-head fixture.** Its two sides are the competition's two teams.

### Projection

13. **Game projection is available for every format**, in any competition or none. It
    means the points this game would award if it ended now — **not cup outcome.**
14. **Projection and finalize share one award function.**

### Roster changes

15. **Standings stay with the unit credited at the time** — the Bengals rule. Nothing reads
    a finished result through the current roster.
16. **Trades are allowed, including head to head, and never move points.**
17. **A teamless player who joins a team has their earlier points nulled.** Nobody else's
    place shifts; their own finish stays on their personal record.
18. **Correction is owner-only** and re-attributes past results to a corrected roster —
    **only for results that did not depend on team composition.** Head-to-head and
    team-format results stand as played. Previewed, scoped, recorded.
19. **A deleted player's results become placeholder results.**
20. **Any roster change after points exist shows a before-and-after preview** and offers
    only valid options.

### Entry points — new in revision 2

21. **Competition creation asks one plain question first: how are you competing?** Head to
    head, or points race. Points race then asks: individuals or teams.
22. **A points race played as individuals has no roster.** Its standings are whoever has
    played in its games.
23. **Individuals-or-teams is editable until the first result, then locked.** Converting a
    teamless race to teams after results would make every participant a teamless player
    joining a team — and ruling 17 would null the entire race. Converting the other way
    would dissolve teams that own points. **Neither is offered once points exist.**
24. **The Cup tab is renamed *Games*, permanently**, and becomes the trip's games page,
    present whether or not a competition exists. **When a competition exists, its hero card
    carries its name** — *BBMI 2026* — so the cup keeps its identity without owning the
    tab. **A game can be created on a trip with no competition.** Its existing structure
    stays: lifecycle sections, reorder, and one add-game button at the bottom.
25. **Add game stays minimal** — name, type, optional delegate — exactly as today. **What a
    game counts toward is decided in setup, not at creation.**
26. **At creation, a game defaults to the trip's competition if one exists, otherwise side
    game.** Setup's first row is *counts toward*, **editable only while the game is still in
    setup — never once it is live.** A live game can have no results yet, and switching a
    live side game into a competition would leave it needing a point value mid-round, which
    is `#1019`'s unanswered question. **Setup-only also guarantees no results exist, so the
    change moves no points and needs no preview.**
    **REVISED 2026-09-27 (PR 6's verify-first pass; Zach framed it, CC decided): *counts
    toward* is chosen AT CREATION, not in setup — reversing 25's "decided in setup" and 26's
    setup row.** Why: `competition_id` is written only by `games.create` ("the ONE door",
    `games.ts:495`), and every cup-membership rule runs there — #1304's format check, PR 4's
    head-to-head refusals, and migration 193's roster trigger, which is INSERT-only and would
    never see a game *moved* into a cup. A setup-time switch is a second door that would need
    all of them re-implemented and enforced in the database. Instead: add game shows one extra
    field — *counts toward* — **only when the trip has a competition**, defaulting to it
    (26's default stands). A wrong choice is fixed by deleting and re-adding the game, which
    costs nothing while it is still in setup. Consequence for the go-live refusal: it must
    name an action that exists — *set a point value, or delete this game and add it again as
    a side game.*
27. **Points appear in setup only for games that count toward a competition.** A side game
    has no points row. **A format that can't be a side game — rack — doesn't offer it.**
    **CORRECTED 2026-09-26 (PR 6, #1493), `allowedContainers`:** rack was not the only one.
    `side_game` is declared on **stroke, match play and skins only**, the golf formats that
    record a result without a competition's teams. Scramble is points-race only; bracket,
    manual and pick'em record against teams and are not side games. The add-game menu
    reads the declaration (`gameTypesForSideGame`), and `games.create` refuses the rest,
    naming why. **Extended 2026-09-27 by PR 7's ruling 1:** the same set is what a teamless
    race admits, and both read one declaration (see PR 7).
28. **Every agenda chip links to its game**, competition or not. A live side game surfaces
    on the trip home exactly as a live competition game does.

### Display

29. **The head-to-head match builder lists only rostered players.** Everyone else appears
    under *ineligible for matches*; add-to-team is offered only to owners and captains, and
    a delegate sees who can do it.
30. **Points-race standings are rows with bars:** banked solid, projected lighter. Leader
    and your own row shown, full list one tap away. **Nothing banked reads "no points
    yet", never "0".** Standings are always high-wins, because every result is points by
    then.

---

## Rulings to PRs

| Ruling | PR |
|---|---|
| 11, principles 1 and 2 | **1** — declared format properties |
| 15 | **2** — standings read the credited unit |
| 6, 7, 8, 9, 13, 14 | **3** — one award function |
| 2, 3, 4, 12 | **4** — head-to-head guards |
| 5 with teams, 7 in points races, 10 | **5** — match formats in points races |
| 1, 24–28 | **6** — side games on a trip |
| 5 without teams, 6, 21, 22, 23 | **7** — teamless competitions |
| 16, 17, 18, 19, 20 | **8** — roster changes |
| 29, 30, principle 3 | **9** — display |

**PR 0 is not on this table.** It is a live correctness bug and ships first regardless.

---

## Order, and why

```
0  double elimination        independent · live bug
   overlap review            alongside 0 · must finish before 1
1  declared properties       everything after reads it
2  credited unit             ┐
4  head-to-head guards       ├ parallel once 1 has merged
6  side games on a trip      ┘ needs only 1 — no schema change
3  award function            needs 1
5  match in points races     needs 1, 3
7  teamless competitions     needs 2, 3   ← JD's case, now reachable
8  roster changes            needs 2, 3
9  display                   needs 3, 7
```

**PR 6 moved early on purpose.** It needs no schema change and fixes the access problem
that actually bit this month. **It is the first thing sixteen people would notice.**

**One feature per branch; merge before starting the next.** Build in the main checkout.

---

## Before PR 1 — overlap review against open issues

**Runs alongside PR 0, and must finish before PR 1 starts.** PR 0 is independent; nothing
else is.

**The backlog has ~95 open issues, each carrying a triage comment from 2026-09-17.** Several
will be instances of work this plan does, some will be made moot by it, and some may
propose a fix that contradicts a ruling here. **Finding that during PR 4 is too late.**

**For every open issue, one verdict:**

| Verdict | Meaning | Action |
|---|---|---|
| **Absorbed** | fully done by a PR here | that PR's body says `Closes #N` |
| **Narrowed** | partly done by a PR here | `Refs #N`, and say what remains |
| **Conflicts** | proposes something a ruling contradicts | **stop and report — Zach decides** |
| **Prerequisite** | must land before a PR here is safe | reorder, and say why |
| **Moot** | stops being true once a PR lands | close at the merge seam, naming the PR |
| **Premise falsified** | disproves something this plan asserts | **stop and report — the plan is wrong, not the issue** |
| **Unaffected** | none of the above | no action |

**Already visible, to seed the pass — verify each rather than trusting this list:**
- **`#1398` is likely a prerequisite for PR 8.** A correction rewrites a game's results. If
  it goes through `writeManualResults` — delete then insert, no transaction — a correction
  that fails halfway can erase a game's results. **Land the atomic write first, or PR 8
  must not use that path.**
- **`#1332` overlaps PR 6.** PR 6 changes the `NOT_READY` message. Readiness is implemented
  twice, in SQL and TypeScript, and they already disagree. **Changing the message in one
  place widens that gap.**
- **`#1019` overlaps PR 6 and PR 4.** Both create new ways a game can stop being ready —
  a side game switched into a competition needs points; a head-to-head team change can
  invalidate pairings. **`#1019` is the unanswered question of what happens then.**
- **`#1032` is likely absorbed by PR 3.** A vacated seat hits a raw database refusal;
  ruling 9 makes an empty side a forfeit.
- **`#1317` overlaps PR 4.** Pick'em has its own clinch derivation, and PR 4 makes clinch
  head-to-head only.

**Report the full table, conflicts first.** Nothing gets closed or reordered until Zach has
read it.

---

## Every PR, before any code

**Phase 0's findings are mostly rung 1 — code reading from one sweep.** `#1250` was
misdiagnosed and `#1361` was never true, both from reading. **Each PR re-verifies the
claims it relies on against current `main`, and stops and reports if any has changed.**

**Each PR's tests must fail against a plausible wrong build**, and the PR shows the
mutation and the red output.

**Any document a PR makes wrong is updated in that PR** — created drift. Found drift is
still reported, not resolved.

**UI PRs (6, 7, 9) have a look-gate:** Zach reviews on a phone before merge.

---

## PR 0 — Double elimination finalizes as single elimination

**Model: Opus.**

**The bug (Phase 0 F1).** `pickWinner` selects the double-elimination resolver
(`games.ts:699`), but the only finalize path, `deriveBracketPlacements`
(`bracketResults.ts:75,83`), always calls `resolveDraw`, which drops lower and final rows
(`bracketAdvance.ts:147,237`). **Production's one double bracket was posted with 4 of 15
matches undecided.** The client preview uses the right resolver and claims to run *"the
SAME three functions the server runs"* (`NonGolfGameView.tsx:818`) — false.

**Fix the duplication, not the call.** Single versus double is decided in two places —
client config and server draw shape (`games.ts:698`). **Make one place decide
elimination type, read by both.**

**Tests that must fail:** a server-side finalize of a double bracket with the lower
bracket undecided refuses or stays incomplete; the client preview and server finalize
produce identical placements for the same draw.

**Also:** correct the false comment. **`GAME_FORMATS.md:291-293` is already corrected** —
PR 0 did it. Report the production "Double Elim Test" game; **leave it as it is** — it is
the only production artifact of the defect.

---

## PR 1 — Declared format properties

**Model: Opus. Propose the representation before applying it** — this is the one
schema-shaped decision, and everything after reads it.

### Ruled 2026-09-22, after CC's verification

**Home: extend `GameTypeDefinition` in `src/lib/gameTypes.ts`.** Already the
format-definition home, client-safe, read synchronously. No new registry, no table.

**PR 1 stays inert.** It declares; PR 3 switches consumers onto the declarations. A
behaviour change here would be a behaviour change with no test that can see it.

**Direction is struck from PR 1 — it is not a property of a format.** CC measured it on
main 2026-09-22 and reported it under the plan's own stop-and-report rule:

- **Bracket runs two directions inside one game** — entrants `low_wins`, then teams
  `high_wins`. Keyed on the stage of the computation, not the format.
- **Pick'em runs opposite directions in different cups**, keyed on the competition's
  scoring model.
- **The manual arm's own comment says its condition is the absence of match rows, *not* the
  game's type.**

**And generalising `rankingDirection` would have been a category error.** It answers *how
do you rank raw golf strokes*; the roll-up's direction answers *how do you rank result-row
values to apply a points distribution*. Different questions over different data.

**Direction is a property of what the result rows carry** — a position is a rank, a raw
score is points already decided. **That is what `#1392` established, and the right home
already exists.** It moves to PR 2 (see below); PR 1 declares the other three.

**Result kind: declare the kinds a format can produce, not the one it does.** `resultStrategy`
already half-encodes this, and **pick'em genuinely produces both** — head-to-head matches
and a points total per sheet, switched by its `roll_up` configuration. **So the format
declares its allowed result kinds — usually exactly one — and the game's own configuration
pins which one is in play.** That is the same shape as everything else here: the format
declares what is possible, the instance declares what is actual, and the rows are checked
against it.

**Allowed containers: a new field, not a widened one.** Keep `compatibleScoringModels`
exactly as it is — `games.create`'s server guard began reading it on 2026-09-22 and PR 4
adds more refusals over it. **Changing a value set under a guard that shipped hours ago is
how a format gets silently admitted or refused.** Add `allowedContainers` alongside it;
reconciling the two is a later cleanup, filed not done.

**Team-dependent: add it as specified.** Nothing declares it today and nothing conflicts.

### The dead-metadata risk, and its exit

`GameTypeDefinition` already carries four declared-but-unread axes, and the file's own
comment records that `compatibleCompetitionFormats` had to be retired as *"dead metadata —
read by nothing"*. **PR 1 adds four more that are unread by design.**

- **Name the intended consumer PR beside each property**, so a later audit can tell *not yet
  read* from *never read*.
- **If a property still has no consumer when PR 9 merges, delete it.** State that in PR 1's
  body as a commitment, not an intention.

| Property | Values | Replaces |
|---|---|---|
| Result kind | head-to-head · ranked | inference from payout shape and branch |
| Team-dependent | yes · no | nothing — ruling 18 needs it |
| Allowed containers | side game · head to head · points race | the `gameTypes.ts` catalog, extended |

**Team-dependent** means a different roster would have produced a different result:
head-to-head formats (pairings depend on teams) and team formats like a scramble.
**Individually scored ranked formats are not** — stroke play, Stableford, skins.

**No behaviour changes in this PR.** Later PRs switch consumers onto the declarations.

**Tests: don't build a guard the compiler already is.** Adding the fields makes `tsc`
refuse a format that omits one, so a runtime presence check can never fail on a tree that
compiles — **it would be inert by construction and would look exactly like protection.**

**Guard what the type system permits and the model doesn't:** an empty `resultKinds` array
(type-checks, means *produces nothing*, and `[]` is truthy), a duplicated entry that would
satisfy a naive *declares both* check, and a format missing from the catalog entirely.
**Plus the rulings as exact sets** — the not-team-dependent set is
`["gtt_skins", "gtt_stroke_play"]`, and a format joining or leaving it changes what PR 8
may rewrite, so it must never move silently.

**`allowedContainers` declares the target, not today's enforcement.** `gtt_match_play`
lists `points_race`, which PR 5 opens — so it deliberately disagrees with
`compatibleScoringModels` until then. **A test asserting they agree would be asserting PR 5
hasn't happened.** Two consequences to state in the PR body: **nothing may read
`allowedContainers` before PR 5**, and **if PR 5 doesn't land, this field is a false claim
sitting in the catalog** — it goes, under the delete-by-PR-9 commitment.

**`teamDependent: true` means *may be*, not *is*.** The manual types are head-to-head as a
matches game and ranked as a placement one, so the honest per-format answer is conditional.
**True is the safe direction for ruling 18** — it refuses a correction that might be
team-dependent rather than rewriting one that is. **A sharper per-instance answer is PR 8's
decision to make, not a surprise it discovers.**

---

## PR 2 — Standings read the credited unit

**Model: Opus.** Ruling 15. **Prerequisite for 7 and 8.**

**Enumerate every reader of a finished result, and whether it resolves the unit through the
current roster.** The Cornhole investigation found `game_results` written per team at
finalize, but also found team resolving through the current `team_assignments` on some
paths, and the live projection works that way.

**For finished results, the credited unit is stored and read — never recomputed from
today's roster.** Projection of an unfinished game may use current rosters.

**If any format does not record its credited unit at finalize, adding it is this PR's
work** — the one deliberate exception to derive-don't-snapshot. **State it in the PR body
so it is not "fixed" later.**

### Also in PR 2 — the row's convention becomes declared, not inferred

**Moved here from PR 1, 2026-09-22.** Direction belongs to the result row, and today the
row does not say what it carries: `rowConvention` infers it from which column is null.
**`#826` is this issue already** — `game_results` carries two currencies, and
`gameFinishNotify.ts:387` sniffs at a value to guess rank-or-score. The ambiguity is
already costing something.

- **Record the convention on the row at finalize**, in the same write that records the
  credited unit. One additive migration, one write path.
- **Backfill is derivable and safe** — it is exactly what `rowConvention` computes from
  column nullness today.
- **`#1392`'s reconciler is kept and reframed**: it stops being *infer, then check the arm*
  and becomes *the declared convention disagrees with what this row actually contains*.
  **That is a real condition and the one that bit production. Never delete it.**
- **PR 3 reads the declaration** instead of the per-arm literals in
  `competitionLeaderboard.ts`.

### Carried forward from PR 2's verify-first pass

**No client surface reads `game_results` at all.** Every game page recomputes from source
data plus today's roster, and `MatchGameView.tsx:571` states it as intent: *"we never store
team on a side — it's DERIVED from the players' roster"*. **So PR 2 makes the board correct
after a trade and leaves the game pages deriving.**

- **PR 8's tests must assert both surfaces**, not just standings. A trade that leaves the
  board right and a finished game page wrong is a divergence people will see and report.
- **PR 3 owns `competitionLeaderboard`'s per-match pool fallback** (`:644`), which sizes
  the pool from current `team_assignments`. **Not live today** — every completed game has
  an owner-set `points_total`, so the fallback never runs — but it is a latent violation of
  ruling 15 and PR 3 is where the read switches.
- **The bracket's credit is protected today only incidentally.** `save_game_config`'s
  `v_bracket_dirty` includes `team_id`, so `HAS_PICKS` freezes it once a winner exists —
  a side effect of protecting the draw, not a decision about credit. **PR 2's stored
  `credited_team_id` is what makes that no longer matter.** Say so in the body, so nobody
  later "optimises" that guard and silently unfreezes credit.

**This is what makes bracket and pick'em work rather than break the model.** A bracket's
entrant rows carry ranks and its team rows carry points; pick'em's rows differ by cup.
**Per-row is the only level at which a single answer is true.**

**Tests that must fail:** finalize, then move a player to another team — standings
unchanged. Same for a player removed from their team.

---

## PR 3 — One award function

**Model: Opus.** Rulings 6, 7, 8, 9, 13, 14.

**One function decides who gets a game's points**, called by projection and finalize alike.
Phase 0 found them diverging — projection credits a teamed side where finalize pays
nothing. **Two implementations of one decision is the F1 pattern.**

It decides the unit, head-to-head payout and halves, ranked payout **with direction from
the row's `value_kind` declared in PR 2 — not from PR 1**, forfeits, and **a game that
cannot project says so rather than showing zero.**

**Corrected 2026-09-22:** this line said *direction from PR 1* and contradicted the ruling
that struck direction from PR 1. `resultKinds` could not supply it anyway — **the manual
winner-takes-all game declares `head_to_head` while its rows carry ranks.** Direction comes
from the row, and only from the row.

**`#1032` is not this PR's.** The overlap review found the seed list wrong about it (it is
not an empty-side forfeit) and replaced that with a second wrong reading, a stale
`baseHash`. **Corrected 2026-09-28:** the refusal was a foreign-key failure from a match
side pointing at a hard-deleted user, fixed at source and closed; see PR 8's prerequisite 2.

**Verify first:** does every placement format produce a live game projection today? Report
which don't, and build them here.

**Tests that must fail:** projection at the final state equals finalize, for every format
fixture; a low-wins ranked format pays the lowest score first; an unteamed participant is
credited as their own unit.

### Split into three, 2026-09-22 — recorded so nothing evaporates

CC split this on the grounds used for `#1398` and `#1413`: a diff where the reviewer can
see one thing. **"PR 3 merged" must not come to mean the award function alone.**

- **3a — the award function** (`#1414`). One `awardMatches` called by projection and
  finalize; the two callers become adapters that say what a recorded result and a current
  standing mean, neither deciding. Forfeits, halves, unit. **`conflicted`'s red proof lands
  here**, with C3 — checking only one direction of the contradiction — as the mutant that
  earns its keep.
- **3b — direction from the declaration.** **Bigger than it reads, and the riskiest piece
  left.** Direction and an arm's distribution kind are the same bit across all seven arms:
  high-wins ⟺ as-scored, low-wins ⟺ schedule. **Deriving direction from the declaration
  forces the arms to stop choosing distribution independently too**, so half of it would
  leave `reconcileConvention`'s warn arms inert while still looking like protection — the
  exact failure this plan keeps catching. **Seven arms, in the code that bit production
  twice. Opus, its own verify-first, and a proposal before any code.**
- **3c — rescoped 2026-09-23, after its verify-first.** Everything in it now has a surface
  Zach can look at: **the empty-schedule collapse at the reconciler** (`#1410`, on *pays
  nothing* rather than *length 0*, so it catches `[0]` as well as `[]`), ***cannot project*
  as a real state** with a reason rather than a silent `null` or a `?? 0`, and **the pick'em
  arm**, reusing `pickemFinalize` and gated on `pickem_picks_revealed`. **Look-gate:** a
  match-play cup row with a pick'em game before and after reveal.
- **Stroke, scramble and skins arms move to PR 9**, their only surface. **Points cups
  display no projection anywhere today** — row pills require a match-play cup
  (`GameRow.tsx:294`) and the hero's projected tier sits inside the match-play-only block —
  so building them in 3c would add three arms nobody can see. **`#1416` also blocks two of
  them**, and stroke's *what does "if it ended now" even mean* question is best settled
  against the bars that would show the answer. `#1120` stays open and moves with them.
- **The bracket is not one of the four.** It is never seen as started (`#1413`), nothing
  places entrants still alive in the draw, and its placement crowns a champion while a
  reset is still owed (`#1417`). **The plan's earlier mention of PR 0's draw helpers here
  was wrong** — `#1120` excludes the bracket and `#1120` is right.

**`#1413` (the bracket's missing `game_started` arm) is separate and not a projection
problem** — a bracket reads as never started, so it sits in Ready for Play for its whole
life. That is a live board bug with its own migration.

---

## PR 4 — Head-to-head guards

**Model: Sonnet.** Rulings 2, 3, 4, 12. **Closes `#1304`.**

**Server refusals, each saying what to do instead:**
- **Exactly two teams** — on creation **and** on `teams.create` / `teams.delete`. Phase 0
  found it checked only at creation (`competitions.ts:362`), where team seeding is
  best-effort.
- **Match formats and rack only.**
- **Every participant rostered.**
- **Clinch fires for head to head only** — `notifyCupClinchedIfDecided` has no type check
  today (`games.ts:1383`).
- **Rack's two sides are the competition's two teams.** Collapse the three paths that pick
  "the two teams" differently (`rackNStack.ts:78`, `liveProjection.ts:392`,
  `RackGameView.tsx:209`).

**Tests that must fail:** each refusal with its guard removed; the clinch push with its
check removed; rack side selection with the three paths restored.

**Docs:** `GAME_FORMATS.md` §6's fallback sentence, and §7's rack wording from `#1402`.

---

## PR 5 — Match formats in points races

**Model: Sonnet.** Rulings 5, 7, 10.

**Open the catalog so head-to-head formats are allowed in points races**, from PR 1's
allowed containers. **Rack stays head-to-head only.**

**Units not in a match are recorded as not-participating, never as a scored zero.** Phase
0 found non-golf Matches writing a zero row for a third team.

**No pairing guard** — same-team matches pay that team, correctly.

**Tests that must fail:** a head-to-head game in a three-unit points race credits only its
two sides, and the third reads as not-participating.

---

## PR 6 — Side games on a trip

**Model: Sonnet**, with a look-gate. Rulings 1, 24–28. **No schema change.**

**This is the access fix.** Today a game can't be created on a trip until a competition
exists, which is the real reason JD built a fake three-team cup — and the practice round
needed a whole separate trip.

### What exists today, verified by Zach

**Cup is a top-level tab** — Home, Trip, Cup, Chat. The page is a hero card (teams,
score, progress, *first to N wins*, *projected if today holds*), then the games grouped by
lifecycle: **ready, configuring, live, completed.** Completed renders as a table with one
points column per team. **At the bottom: reorder on the left, add game beside it.** Add
game takes a name, a type and an optional delegate; **points and everything else are set
during setup.**

**That structure is sound and this PR keeps it.** Lifecycle is the right primary grouping —
people think *what's live, what's next*, not *what counts*. The change is ownership, not
layout.

### The change

**The Cup tab becomes the trip's games page.** It exists from the moment the trip does.

**No competition on the trip:**

```
┌──────────────────────────────────────┐
│ [setup guide's create-a-competition  │
│  call to action, reused]             │
└──────────────────────────────────────┘
LIVE 1
  Practice round
CONFIGURING 1
  Skins, back nine
[reorder]  [add game]
```

- **Reuse the existing *create a competition* call to action from the trip's setup guide**
  (Zach, 2026-09-22) — the same component, placed where the hero would be. **No new card
  to design.** Its destination is the create flow, which PR 7 changes; the call to action
  itself doesn't need to.
- **Reuse, don't move.** The setup guide is dismissed by *Switch to itinerary*, and after
  that its call to action is gone. **The games page is the persistent home for it** —
  it's where the intent to compete comes up later in a trip. Keep it in both places.
- **Show it only to people who can create a competition.** The setup guide is already
  limited to owners and organizers (`ItineraryPanel.tsx`); members take an earlier branch.
  **The games page is seen by everyone, so the same rule has to travel with the
  component** — the UI never offers what the backend refuses. **Verify first** whether the
  role check lives in the component or in the setup guide around it.
- **Lifecycle sections, reorder and add game work exactly as today.**

**With a competition:** the page is today's cup page. **Side games sit in the same
lifecycle sections, marked with a *side game* tag.** No second list, no second add
button.

### Where *counts toward* lives

> **SUPERSEDED 2026-09-27 — see the note under ruling 26.** *Counts toward* is chosen at
> creation (one field, shown only when the trip has a competition), not in setup, so
> `games.create` stays the only writer of `competition_id`. Also decided in that pass:
> PR 6 splits into **6a** (`UNIQUE (trip_id)`, migration 195) and **6b** (the games page:
> trip-scoped list and ordering, the *Games* tab on desktop too, CLAUDE.md #20's stale
> "~40% standalone" corrected, `HomeTab`'s dead props removed); the create-a-competition
> card is a new compact card (the setup guide's version was retired) for Owner **and**
> Organizer, and the settings modal's *Enable competition* is aligned to the same roles; the
> trip-home live surface (ruling 28's second half) moves to PR 9 — nothing exists to mirror.
> The text below is the original plan, kept for the record.

**In setup, not at creation.** Add game stays name, type and delegate. **Setup's first
row is *counts toward*** — the trip's competition or *side game* — and it pairs the
decision with its consequence: **a cup game shows a points row; a side game doesn't.**

- **Default at creation:** the trip's competition if one exists, otherwise side game.
- **Editable only while the game is in setup, never once it is live.** A live game can
  have no results yet, and switching a live side game into a competition would leave it
  needing a point value mid-round — `#1019`. **Setup-only also guarantees no results, so
  the change moves no points and needs no preview.**
- **Rack can't be a side game** — it's a head-to-head fixture — so the side-game option
  isn't offered for it.

**The safety net for a wrong default already exists.** A competition game can't go live
without a point value (`save_game_config`'s `NOT_READY` refusal). **So a practice round
left in the cup by mistake gets stopped at go-live** — but today's message only says *set a
point value*, which pushes toward the wrong fix. **Change it to offer both: set a point
value, or make this a side game.**

### One competition per trip — enforced, not assumed

**Zach ruled it 2026-09-22: one per trip, and the database says so.**

`#1342` confirmed there is no `UNIQUE (trip_id)` on `competitions` — the rule is enforced
only by `competitions.create` reading first, which is a race. **Two organizers tapping at
once get two cups**, and both PR 6's *counts toward* and PR 7's create flow assume one.

- **Check production first** for any trip with more than one competition. **If any exist,
  stop and report** — the constraint can't be added over them, and that is a different
  decision.
- **If clean, add `UNIQUE (trip_id)` in this PR.** A limit the model checks, not an `if` in
  create.
- **Record in `TRACKER.md` that lifting it is a deliberate future decision**, not drift — a
  trip that one day wants a cup *and* a side points race would drop the constraint on
  purpose.

**Do not build multi-competition selection here.**

### Displaying side games in the existing sections

- **Ready, configuring and live:** the card gains a *side game* tag and shows no points.
- **Completed:** the table has one column per team, and a side game has no team points.
  **Don't render zeros** — a side game row shows its winner in place of the team columns.
  Zeros would read as a result.
- **The hero's score, progress and projection count competition games only.**

### Also

- **Every agenda chip links to its game.** Phase 0 found the chip is a `<div>`
  (`ScheduleTab.tsx:298`) and the schedule filters by `competition_id`
  (`ScheduleTab.tsx:536`).
- **A live side game surfaces on the trip home** as a live competition game does.

### Not in this PR

**Moving a game that already has results into or out of a competition.** That moves points
and needs preview rules — it's the case where a group plays a few side rounds *then*
starts a competition. **Follow-on, and the next thing to design.** Moving a game with no
results is in this PR, because it moves nothing.

### Vocabulary — decided

**The tab is *Games*, permanently.** Zach ruled it 2026-09-22. *Cup* was wrong for a trip
with no competition and for a teamless points race. **The competition keeps its identity
through its hero card, which carries its own name.** Do not label the tab by content —
a nav item that changes name depending on what's inside it is harder to find.

**This narrows PR 7's open noun question** to what the container is called in copy like
*Start a competition* and *counts toward*. The tab is no longer part of it.

**Tests that must fail:**
- A game can be created on a trip with no competition. **Fails against today's code.**
- The tab reads *Games* on every trip, with and without a competition.
- The games page renders with no competition, with add game present.
- The create-a-competition call to action appears on the games page for owners and
  organizers, and not for members.
- A game created on a trip with a competition defaults to it; setup can switch it to a
  side game before its first result, and can't after.
- A side game has no points row and never contributes to the hero's score.
- Rack is never offered as a side game.
- A second competition on the same trip is refused by the database, not by a read-first
  check. **Prove it red by attempting two inserts against a tree without the migration.**
- A side game in the completed table shows its winner, never team zeros.
- The `NOT_READY` refusal on a competition game offers *make this a side game*.

### Ruled 2026-09-27, after the 6b looks

- **Side games belong on the agenda.** The agenda is the trip's schedule, and a practice
  round happens on a day. Keeping side games off it would reintroduce "the competition
  owns visibility", which is what this PR undoes.
- **`NOT_READY` remap: no dedicated migration.** Key it on the database's current text,
  pinned EXACTLY by a test against the real refusal, so a rewording fails CI. The proper
  code lands the next time `save_game_config` is redefined anyway (#1430, #1442, #1474 all
  touch it). The side-game half reads `allowedContainers`, so PR 7 extends it by editing
  the declaration. Done on #1497 (`abf93b88`), red-proven by four mutants.
- **Live updates for side games are next, straight after 6b: #1498.** This is an ordering
  exception. 6b makes side games playable, so a practice round across several phones that
  refreshes only on save or return is the trip's most common complaint in the exact use
  case side games exist for.
- **One sweep before 6b merges:** every branch gated on having a competition, on a path a
  side game travels. Classify each as correct-to-skip (clinch, standings, cup points) or
  wrongly skipped. Pushes are the likeliest next instance: who gets `game_finished` for a
  side game? **Done on #1497 (`2b71471d`, `80f91ccd`, `a8c295b5`):** seven wrongly
  skipped or wrongly keyed. Fixed: the match push had no winner, the push linked to the
  standalone route, exit and delete landed on the Trip tab, correction and a match rename
  didn't refresh the side list, and a side match game read the trip's cup. Each has a
  red-proven test. The rule it produced is CLAUDE.md #29: a game's competition is
  `game.competition_id`, never the trip's cup, and its home is the Games page.
- **Scoring locks until someone is grouped** on stroke and scramble, matching rack and
  skins (#706, `533b6f46`).

---

## PR 7 — Teamless competitions

**Model: Opus**, with a look-gate. Rulings 5, 6, 21, 22, 23. **JD's case**, now reachable.

### Verify first

**What the create-competition flow looks like today, and whether it requires teams.**
Phase 0 found `competitions.ts:362` seeding teams for match play; the points path is
unconfirmed.

### The flow — creating a competition

**Screen 1 — one question, in plain words:**

```
How are you competing?

  Head to head
  Two teams play matches against each other.
  Ryder Cup style — knows when a side has clinched.

  Points race
  Everyone earns points across the games you add.
  Play as individuals, or split into teams.
```

**Head to head** → name, two teams, rosters — the existing team setup.

**Points race** → name, then:

```
Play as
  (•) Individuals
  ( ) Teams
```

- **Individuals is the default** — structure is something you add, not something you're
  made to build. **There is no roster step at all.**
- **Teams** → the existing team builder, any number of teams.

**Then land on the competition**, with an empty state: *Add a game to start the
standings.*

### How a teamless race behaves

- **No roster.** A participant becomes a row the first time they play in one of the race's
  games. A game added with players shows them as *no points yet*.
- **Individuals-or-teams stays editable until the first result, then locks**, with the
  reason shown — ruling 23.

### Engine work — Phase 0 found team assumptions throughout

- **The bracket refuses a null team** (`games.ts:1811`) and infers team from an entrant's
  first member (`configDraft.ts:827`). **Entrants must be able to be people.**
- ~~**Non-golf Matches takes `[a, b] = teams`** (`MatchesBuilder.tsx:69`).~~ **Fixed in PR 5**:
  the builder binds sides to teams only in a head-to-head cup; in a points race any rostered
  player may play either side. What remains for PR 7 is a race with **no** teams, where the
  builder currently renders nothing (`teams.length === 0`).
- **Finalize for a standalone Matches game writes no results** — gated only on
  `competition_id`.

### Carried from PR 5 — decided there, deliberately left to this PR (2026-09-26)

- **Ruling 6's match half is DEFERRED HERE, on purpose — not a gap.** Ruling 6 says the scoring
  unit is the participant when they have no team. For MATCHES it is not implemented: PR 3a kept
  "a match pays only when both sides resolve to a cup team" (`awardMatches`), and named
  own-unit-versus-forfeit as a product decision it did not take. PR 5 kept that, and keeps the
  picker to rostered players in a teamed race. **This PR decides it**, because a teamless race is
  where a person is the only unit there is: is a person in a match credited as their own unit,
  and what does a match against an unteamed side pay?
- **2v2 in a teamless race.** PR 5 made "a side must resolve to one unit" a structural refusal
  (`splitSideRefusal`). In a teamless race every person is their own unit, so every two-person
  side spans two, and **under that rule 2v2 formats are impossible in a teamless race**. That may
  be right. If it is not, the mechanism is **split payouts** (TRACKER.md): a side's winnings
  divided among the units it contains, which is also what a cross-team-partners format would
  need. Decide before building, rather than discovering it when the first pair is refused.

**Enumerate every remaining "a competition always has teams" assumption before changing
any.** That list is the scope.

**Tests that must fail:** a teamless race with a stroke round and a match round produces
per-person standings; a bracket with person entrants finalizes; switching to teams after a
result is refused.

### Verify-first, done 2026-09-27

**Today's create flow requires teams.** `CompetitionSetupPanel` offers "Head-to-head" or
"Teams" (a points race), with a team stepper whose minimum is 2. `competitions.create`
refuses fewer than 2 and always seeds them (`competitions.ts:299, 382`). A points cup can
still reach zero teams afterwards, since teams can be deleted before a game starts, and then
the whole board is replaced by *No teams yet* (`CompetitionLeaderboard.tsx:280`), with no
way back to settings or add-game, and a message naming a tab that no longer exists.
Confirmed in a browser and filed as **#1502**; not fixed separately, because PR 7 makes zero
teams a legitimate state. **PR 7 closes #1502.**

**The schema already allows a teamless race.** Nothing requires a competition to have teams,
and a `user` result row is allowed. The storage speaks units (`game_results.entity_type`);
**only the readers are team-only.** `team_assignments.team_id` is NOT NULL, so there is no
"in the race, no team" roster row, which fits ruling 22.

**Team-only today, found on `main`:** the standings read only `team`/`entrant` rows and key
everything by team id, and `awardedForGame` pays 0 when `numTeams` is 0. The live
projection is team-keyed. Match play writes no cup points without teams, and its per-side
rows carry rank 1/2 only, with no points and no halve. Matches, pick'em and manual write
nothing; the bracket can't be saved; scramble can't go live. `splitSides` refuses every 2v2
side, `MatchesBuilder` renders nothing, and the *game final* push names no winner.
**Already fine:** stroke and skins write per-person rows; `rosterLock`'s `game_started`
check is exactly ruling 23's "first result".

### Ruled 2026-09-27, after the verify-first

1. **Formats: stroke, skins and match play**, the same three as side games, and for the same
   reason: each records a result per person. **One declaration, read by both** `side_game`
   and a teamless race (something like *records per-person results*), rather than two lists
   that drift. Match play gains points and halves on its per-side rows, which is modest.
   **Everything else waits**, so *a bracket with person entrants finalizes* moves out of this
   PR's tests.
2. **Match credit: already ruled.** A person is their own unit (ruling 6). A win pays the
   game's points; a halve splits them (ruling 7). PR 5's deferred question was own unit or
   forfeit for an unteamed side, and in a teamless race there is no team to forfeit to, so
   **own unit**.
3. **2v2 in a teamless race is refused.** Split payouts are a future feature, and the
   refusal already says *until split payouts exist*. With three people 2v2 can't happen
   anyway.
4. **Generalize the board; don't build a second one.** Mixed cups need it: a race with Team A,
   Team B and Player C can't be served by a person-keyed board or a team-keyed one. And the
   storage already speaks units, so only the reader is team-only. A second board would be
   the F1 pattern again. **Treat it at 3b's scale**: the leaderboard is the code that bit
   production twice, so verify-first, a proposal before code, and mutants.
5. **The *game final* push reuses the side-game winner reader** (`readSideGameWinners`). A
   teamless race's game carries per-person results exactly as a side game does. One reader.

**Also:** file `competition_points_earned` as dead (never written, never read). Fix the
stale `teams.ts:255` roster-lock comment in this PR. *(Already recorded as dead on #826;
re-measured there rather than filed twice.)*

### The board: the proposal, and its rulings (2026-09-28)

**The model.** A **unit** is a team or a person. A head-to-head cup's units are its two
teams. A points race's units are its teams plus every person who has played one of its
games and is on no team (ruling 22); a person with no result yet reads *no points yet*.
**One reader rule: a result row credits a unit only if its entity IS a unit.**

| Row | Credits |
|---|---|
| team row | that team |
| person row | that person, only if they are on no team |
| bracket entrant row | its stored `credited_team_id`, unchanged |
| 2-person group row | nothing (2v2 is refused in a teamless race; a teamed 2v2 already has team rows) |

In a teamed race no person is a unit, so every person row is ignored exactly as today:
**teamed and head-to-head cups are byte-identical before and after**, and a control test
pins it. The machinery below the read (`rollUp`, `placementPoints`, `gamePayout`,
`settledPool`, `bankedOnlyWhenFinished`) is already unit-agnostic; what changes is the
results read, the competitor list, "places paid" (`numTeams` → number of units), and the
payload's team-keyed fields. Measured 2026-09-27: 30 cup games in production, zero unteamed
participants in any of them.

**Match play's writer**, because migration 194 allows one row per person per game and the
board refuses a row that declares points while carrying a position: in a teamless race each
player's row becomes a points row, from `awardMatches` (a win pays the per-match value, a
halve splits it), with no position. Side games and teamed cups keep today's rows. The
shared winner reader (ruling 5) learns to read points rows: a winner has points above 0,
which matches how a halve already reads as a shared first.

**Rulings:**

- **A — mixed ranked games are deferred.** A stroke or skins game in a race that mixes
  teams and individuals stays out of PR 7. Production has none, and PR 7's own case never
  mixes. **Two facts to start from when it is decided:**
  - **Ruling 6, read literally, points toward per-person payout credited to the unit** — a
    participant's points go to their team if they have one, otherwise to them. Each person
    earns a place and the team collects it, which is how the bracket already works.
  - **Today's teamed stroke rule is flawed on its own terms.** A team's value is the SUM of
    its members' totals (`src/lib/strokePlay.ts:436`), which compares teams unequally when
    they have different numbers of finishers. So the choice is not "preserve today's rule or
    adopt a new one": it is choosing one rule that works for mixed races **and** for unequal
    teams. Per-person-then-credit and a team average fix different halves of that.
- **B — "individuals or teams" is derived: a race plays as teams if and only if it has
  teams.** A stored flag would be a second source of truth that can disagree with the team
  count — the pattern this plan keeps removing. No migration; `rosterLock` already freezes
  it at the first result (ruling 23); and it resolves #1502.
- **C — PR 7's board for a teamless race:** completed games show their winners line (the
  side-game row, same data), and the standings are a ranked list of units with *no points
  yet* rather than 0. Ruling 30's direction minus the bars; the bars and projection stay in
  PR 9.
- **D — rename to units in PR 7** (`units`, `unitTotals`, `cells[].unitId`,
  `projectedUnitTotals`). The meaning changes in this PR, so it is the cheapest moment; the
  compiler finds every site.

**The deploy check that comes with D, answered.** The query cache is **in memory only**:
no React Query persister is installed, the service worker never answers a request
(`public/sw.js`), and the only persisted cache is chat's own. So there is nothing to
version-bump. **The live risk is version skew instead:** a phone with the app open during
the deploy keeps the OLD client, whose requests reach the NEW server. Skew protection is
not configured in the repo (no `deploymentId`) and the project API does not report it, so
it is treated as off. **For one release the payload also carries the old `team*` names**
(for head-to-head and teamed cups their values are identical, because units are teams; a
teamless race is new, so no old client has rendered one), and a follow-up PR removes them
once the deploy has settled.

**Mutants (3b scale):** the reader drops person rows; **a teamed person is also credited as
a unit** (the double count the byte-identical control exists to prevent); "places paid"
still counts teams; the match writer keeps a position on points rows; the unit list is built
from teams only.

---

## PR 8 — Roster changes

**Model: Opus.** Rulings 16, 17, 18, 19, 20.

### Prerequisites — verified 2026-09-28, then ruled

The overlap review's list was verified before any code, and **two of its three entries were
wrong as written.** What follows is the verified version and Zach's rulings on it; the
original list is in this file's history.

**1 · Dead writers first (`#1429`), then the atomic write (`#1398`).**
- `#1398` is confirmed: `writeManualResults` is delete-then-insert over PostgREST with
  nothing spanning them, and a correction that fails between leaves `status='complete'`
  with no results while `pointsAvailable` still counts the game. **PR 8 must not correct
  through it.**
- It had three callers: `finish`'s manual and bracket arms, and `games.setManualResults`.
  A second writer of the same kind, `matches.removeMatch`, deleted rows outside the atomic
  writer too. **Neither `setManualResults` nor `removeMatch` had a caller in the app.**
- **Ruled: delete both rather than convert them** — "fixing a writer nothing calls is
  maintaining dead code". They go in `#1429`, which lands first, so `#1398` converts only
  the two live callers. *(`#1429`: PR `#1508`.)*

**2 · The stale-snapshot "class" was not one class.** Of the four items named, one was a
live bug and it was not the one the plan described:
- **`#1032` — the plan's diagnosis was wrong, twice.** It is not an empty-side forfeit
  (the seed list) and not a stale `baseHash` (the PR 3 section): a match side still pointed
  at a hard-deleted `users` row and failed a foreign key on the clean-replace save. A stale
  base throws its own readable `CONFLICT`. Fixed at source (migrations 130 and 142), the
  production row repaired, a re-sweep found zero dangling refs. **Closed; its two leftovers
  are `#1506` (the constraint failure reads "reload and try again") and `#1507` (removing
  a member vacates seats without refreshing open settings, and the hash-mover guard cannot
  see writes in `server/lib`).**
- **`#703` is closed**, and it was a missing baseline, not a stale one.
- **`#1017` is a merged PR, not an issue** — it is the seat vacate itself.
- **`#1405` is open and real**, but it is a client cache race: roster mutations snapshot the
  list and restore it on error, so one failed tap wipes a sibling tap that succeeded.
  `ScheduleTab` and `MemberEditor` use the same idiom, which `CLAUDE.md` #1 prescribes
  against.

**Ruled — C and A as the core, plus B; D goes with `#1032`'s leftovers (`#1506`):**
- **C** (`#1405`) — roster and schedule mutations re-fetch on error instead of restoring a
  snapshot, and every writer of the bootstrap-seeded caches is cancelled.
- **A** — `useConfigDraft` says the server moved under an open draft *before* Save, rather
  than as a conflict after it.
- **B** (`#1507`) — the guard learns to see writes in shared server code, and removing a
  member refreshes the games it touched.

**3 · The real prerequisite, which the list did not name: rosters have no concurrency
check.** Assignments are in no version or fingerprint, and assign/remove take no base, so
a before-and-after preview could be confirmed against a roster another organizer has since
changed. **Ruled: a roster fingerprint checked at confirm** — the config hash's pattern, so
one mechanism rather than two, **but separate from the config hash**, or every roster change
would conflict with every open settings draft. A preview carries the fingerprint it was
built on; confirm refuses with *the roster changed — review again* if it moved. **A preview
confirmed against a roster that has since changed is worse than no preview.**

**4 · The permissions pass.** The rule PR 8 needs was credited here to `#448`. **It is
ruling 29, and it is Zach's** — `#448` never mentions captains or delegates, and its tiers
say "structure = owner", the opposite direction. What the verification found: `#448`'s first
bullet is fixed (`assign` and `remove` are Organizer on the server); team create/delete are
Organizer on the server and Owner-only in the UI; an Organizer gets a drag in the rosters
overlay that drops nowhere; `PERMISSIONS.md` contradicts the code in four places; and every
roster mismatch runs the same way — **the server allows what the UI hides.**

**Ruled (recommendations Zach can overrule):**
- **Organizers keep add, remove and move, and the UI matches the server.** Make the
  Organizer drag work.
- **Team create and delete are Organizer**, as the server allows. Whoever can delete a
  team can rename it.
- **Captains: before the race has results, add unassigned players and remove their own.
  After results, nothing** — every change then carries scoring consequences and a preview
  (rulings 17 and 20), which belongs to owners and organizers. So a captain cannot add a
  teamless player after results, and **pulling someone off another team is a trade**: it
  touches two teams, it is Organizer-level, and **the upsert must refuse it.**
- **`co_admin`:** if it is the same concept as Organizer, collapse it to one name. **Done (2026-10-01):** it was the same concept — the competition role a trip Organizer resolves to — and is now `organizer` everywhere in code and copy (code-identifier + display-string tier; no DB value ever held it).
- **Delegation grants no roster rights** — explicitly (Zach's ruling).

**5 · Account linking (`#1481`), because PR 7's per-person rows and PR 8's placeholder
results both make it easier to reach.** Both linking paths refuse only a same-HOLE scoring
collision; the merge silently resolves every other one by deleting the placeholder's rows,
and two identities on opposite sides of one match would put one person on both.
**Ruled: refuse whenever both identities are participants in the same game at all, and
tighten the scoring check to the same game.** A placeholder and a real account in one game
is a duplicate person; the organizer removes the duplicate before linking.

### The roster editor — answered, not outstanding

**Root-caused and fixed as `#1406`.** PR A is exonerated: the cause was an uncancelled
`faceBootstrap` re-seeding the roster cache behind an optimistic write. **Nothing was ever
lost to the database, only to the cache, and the cache no longer loses it.** The residual
findings are `#1404` and `#1405`. `#1405` is prerequisite 2's **C**. **`#1404` (concurrent
adds can tie on `team_assignments.sort_order`) was not part of the 2026-09-28 rulings** — it
is a roster race of the same neighbourhood as prerequisite 3, and whether it rides with the
fingerprint work is open.

**Every change after points exist opens a before-and-after preview**, offering only valid
options.

- **Trade** — allowed everywhere, moves no points; head-to-head clinch is unaffected.
- **Teamless player joins a team** — earlier points nulled; nobody else's place shifts.
- **Correction** — owner only; re-attributes only where PR 1 declares the format
  team-independent. Team-dependent results appear in the preview as locked, with the
  reason.
- **Deletion** — results become placeholder results.

**Corrections are recorded: who, when, which games, before and after.** `games` has no
audit trail today — why nobody could date Cornhole's `[8]`. **Propose where the record
lives before building; likely a migration.**

**Permissions:** as ruled in prerequisite 4 above (from ruling 29). **The UI never offers
what the backend refuses.** Phase 0's F2 (`PHASE0-composable-primitives-REPORT.md`, §2) is
that exact bug in the bracket:

> Bracket pick permission: the guard allows owner, co-admin or delegate (`games.ts:643`);
> RLS allows trip Owner/Organizer only (`112:147`); checked with `assertNoError` only.
> ⚠ A delegate or co-admin who is only a trip Member may get a silent 0-row update.
> Needs a RUN.

**It runs opposite to every roster finding** — there the server allows what the UI hides;
here the code offers what the database quietly refuses. **It needs a run before anything is
built on it.** (Line numbers are as of `32b52300`.)

**Tests that must fail:** a trade after finalize leaves standings unchanged; a correction on
a head-to-head game is refused; a correction on a stroke round re-attributes and records; a
captain cannot correct; a delegate cannot add to a team.

### Verify-first, done 2026-10-02 — and the finding that split PR 8

**The roster lock was holding up rulings 15–17, and nothing said so.** `assertRosterUnlocked`
(and `_competition_roster_locked` for captains) refuses every move, removal and team delete
once any game in the cup has a score. Ruling 16 lifts that for trades. But the five result
writers (stroke/scramble, skins, match play's awards, rack, pick'em) rebuilt their team rows
from the CURRENT `team_assignments`, and a correction re-runs them — so with the lock gone, a
trade followed by a one-hole correction carries a finished round to the new team. PR 2 made
the board read stored credit; the writers' own re-reads were not on its list because the lock
made them unreachable. (CLAUDE.md now carries the general rule: before removing a guard,
enumerate what it was making unreachable.)

**Ruled (2026-10-02):**

- **Split.** **8a** — a finished game is credited through the roster it FIRST finalized with
  (`games.credited_roster`, migration 203; server only). **8b** — lift the lock for trades and
  removals behind the fingerprint-checked preview (a surface: look first). **8c** — the owner
  correction for team-independent games (`teamDependent: false`: stroke play, skins), with
  its record. **8d — leaving a trip is an ARCHIVE** (ruling 19, settled by Zach 2026-10-02):
  account deletion keeps migration 132's "Deleted User" placeholder; leaving or being removed
  from a trip takes the trip off the person's list and stops its notifications, and their
  results stay attached to them. It replaces today's refusal (`findContributionBlockers`) for
  people with results. Disconnecting someone from their data on removal is an escape clause
  recorded in TRACKER.md, not part of 8d.
- **Why a column and not the result rows** (8a's design question): rack and pick'em write
  team rows only; a re-finalize needs person → team, which team rows do not carry; and
  migration 191 keeps `credited_team_id` NULL on person rows deliberately. One jsonb map per
  game, written only while NULL (first finalize wins, in the database), cleared by a scoring
  reset, re-keyed by the guest merge. NULL = never credited; `{}` = credited with nobody on a
  team; absent from a map = on no team then (ruling 17).
- **A trade while the person is in an UNFINISHED team-dependent game is refused (8b),**
  naming the game, as #1481's refusal does — finish the match or unpair them first. During an
  unfinished team-INDEPENDENT game (a stroke round) it is allowed, and the result credits the
  new team at finalize: under ruling 15 a game's points are not earned until it finalizes.
- **The correction record gets a visible consumer (8c):** a small "corrected" note on the
  affected game's completed row, saying by whom and when. The before/after detail stays in the
  record for anyone investigating. A correction changes standings after the fact; a silent
  one breeds suspicion.
- **`#1404` stays separate** — cosmetic, and not part of the preview's correctness.
- **F2 is done** (#1523, migration 198): a game's delegate can record a bracket pick, and a
  refused pick fails loudly.

**Carried to 8b:** a team deleted after a game finalized can still be named in that game's
credited roster; rack and pick'em build their team list from `teams`, so on a re-finalize
that team's members would credit nowhere. Lifting the lock for team delete has to decide this.

---

## PR 9 — Display

**Model: Sonnet**, with a look-gate.

- **The head-to-head match builder** — rostered players, then *ineligible for matches*,
  add-to-team offered by role.
- **Points-race standings as rows with bars** — banked solid, projected lighter; leader and
  your row, expandable; *no points yet* rather than 0.
- **The `AS` chip** — an unplayed match renders "AS" identically to a halved result
  (`MatchCard.tsx:275`). The data distinguishes them; the display should.
- **A live game surfaces on the trip home — moved here from PR 6 (ruling 28's second half,
  2026-09-27).** It was written to mirror "as a live competition game does", and PR 6's
  verify-first pass found **nothing on the trip home surfaces a live game at all** today:
  Home shows linked games only as name chips on agenda items (`ItineraryView.tsx:1402`),
  never their status. So this is a new surface to design, for competition and side games
  alike, not a copy of an existing one.

**Look-gate:** a three-team points race and a teamless race, on a phone.

---

## Vocabulary

**User-facing names are *head to head* and *points race*.** The code keeps its existing
names. **Decide once, in PR 7, whether *competition* or *cup* is the user-facing noun** —
BBMI calls it a cup, and a teamless points race between three friends is not obviously a
cup. **Do not let the two drift across screens.**

---

## Out of scope

- **The Circle schema and RLS migration**, and with it **creating a game from the home page
  with no trip.** `trip_id` is `NOT NULL`, and RLS gates on `is_trip_member`. Its own Phase
  0.
- **Moving a game into or out of a competition after creation.** Follow-on to PR 6.
- **Leagues and seasons** — this is their foundation, not their build.
- **Points-race clinch** — a future setting.
- **External data feeds and prediction beyond pick'em.**
- **The duplication inventory** — fix a duplicate when a PR touches it; do not sweep.

---

## Code versus documentation

Verify every behavioural claim against `src/` and `supabase/migrations/` — not against
`CLAUDE.md`, `STYLE_GUIDE.md`, `GAME_FORMATS.md`, `PERMISSIONS.md`,
`COMPETITION_ENGINE.md`, or any spec including this one. The docs in this repo drift, and
this plan was written by someone who cannot see the code.

**If the code and a document disagree, that is a finding to report — not a discrepancy to
resolve.** Quote both, name the file and line for each, and stop.

- **Do not change the code to match the document.**
- **Do not change the document to match the code.**

**Exception, stated in the doc itself:** `GAME_FORMATS.md:5–13` — for format semantics,
code diverging from the doc presumptively means a code bug.

**`COMPETITION_ENGINE.md` describes a design that was never built.** Do not cite it as
current behaviour.

## When a rule blocks you

If a rule in `CLAUDE.md` or a constraint in this plan blocks the obvious path, **say so
before complying.** Name the rule, what it prevents, and the straightforward alternative.

## Issue hygiene

**Before opening anything, apply `CLAUDE.md`'s entry rule.** Prefer an instance on an
existing issue over a new sibling — Phase 0 already named `#1332`, `#934`, `#1029`,
`#1120`, `#1368`.

**In each PR body:** `Closes #N` for issues fully resolved, `Refs #N` for anything
narrowed. **Never `Closes` a partially addressed issue.**

**End every session's report with the ledger** — opened, closes on merge, stays open and
why.
