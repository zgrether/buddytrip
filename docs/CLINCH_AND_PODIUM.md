# Points Cups: Clinch Watch & Place Locks (build spec)

*Scope: Workflow Wireframes canvas, row 6 only (boards F0–F4). Companion to `COMPETITION_ENGINE.md`.*
*Designed 2026-11-03 → 05. Model: Opus (multi-file). One branch, per-task commits.*

**Mockups:** `docs/mockups/points-clinch/` in the repo. `index.html` has all five boards (F0–F4) live, and there's a PNG per board. They are the visual target. **The spec governs behaviour:** where a mockup and the spec disagree, the spec wins, and you report the mismatch. The trophy in the mockups is a static port of `CupTrophy`, and the colours and fonts are approximations: use the real component and the tokens.

**Guiding rule.** BuddyTrip is a scorekeeping app first. The crew is out playing, not watching the app, so a clinch is a clear *state* on the board, not a show. Celebration waits until every game is final.

**Reuse rule.** Don't duplicate what exists: `CupTrophy`, `ClinchCelebration`, `StandingsRows` (+ `hatch()`), `TeamBadge`, `Sheet`, `ReorderableList`, `NeedsAttentionCard`, the clinch push and claim. New UI is only for what's new: the clinch watch and the place-lock chip.

**Two prior rulings this reverses (deliberately):**
1. `CompetitionLeaderboard` passes **short** names to `StandingsRows` ("a standings row is a label slot"). Now: **full names**; a standings row is a **subject** slot. Update STYLE_GUIDE "Team names — subject slots vs label slots" in the same PR.
2. `gameFinishNotify`: "Ruling 4 (PR 4): head to head owns CUP clinch. No other competition type fires one." Now: points cups fire a clinch too, **from the new math below**, never from `pointsToClinch`.

---

## Phase 0 · Measure, report, STOP

Report back, build nothing:

1. **X_g per game type in a points cup:** the most one unit can earn from one game (from `points_distribution` / `points_total` / the effective distribution). List every game type that can sit in a points cup and its X_g source. Zach's ruling: every cup type has a fixed top award. Flag any type where you can't find it.
2. **Replay history:** run the §1 math over the production points cups (BBMI 2024, 2025) in game-finish order. For each cup report when 1st clinched (after which game, how many left), when each other place locked, and whether any lock ever reverted. This is the sanity check on the math against real data.
3. Where the points hero renders today (`CompetitionHero` non-race branch, `NEUTRAL_CARD`, no `ClinchCelebration`), and the `StandingsRows` call site.
4. The teamless path (points race of people, `kind="players"`): individual players behave exactly like teams everywhere in this spec (Zach). Confirm the math, standings, hero, push and tiebreak all apply to units unchanged, and report anything team-only that would block it.
5. How `isCupComplete` and `gamesRemaining` behave for a points cup, including a tie for 1st with nothing left.

STOP. Wait for Zach.

---

## 1 · The math: new pure module (e.g. `lib/pointsClinch.ts`)

Units = teams, or people in a teamless race. **X_g** = the most one unit can earn from game g.

```
inPlay          = Σ X_g over games not yet banked     // live games count in full (same as settledPool)
safe(A over B)  = pts(A) − pts(B) > inPlay            // strict: a lead that can only be tied is not safe
placeLocked(T)  = every unit above T is safe over T  AND  T is safe over every unit below T
clincher        = the 1st-place unit, if placeLocked(it)
out(T, p)       = some unit at or above place p is safe over T     // T can no longer reach place p
```

- **Exact.** Each pair's worst case (one unit takes everything left, the other gets 0) is reachable independently of every other unit, so checking pairs is the complete test. Places lock in any order: 3rd can lock while 1st is still open.
- **Derived, never stored**, like `pointsToClinch` today. Banked points only (`bankedOnlyWhenFinished`). Adding a game raises `inPlay`, so a lock reverts by itself.
- Two-team match play keeps `winThreshold`. This module is only for points cups (`!isRace`).

**winsNeeded(L, p)** (drives the headline; order-free, never names a "next game"):

```
smallest |S| over sets S of unbanked games such that, if L finishes 1st in every g ∈ S
(other awards in g go lowest → closest chaser), L is safe over every unit it must stay ahead of,
with Σ_{g∉S} X_g still in play.
```

Brute force over subsets (cups ≤ ~15 games). It's almost never null, since a sweep always clinches, so it's only shown at ≤ 2.

**Tests (same style as `pickemBoard.test.ts`):**
- clinches only on a strict lead over `inPlay`;
- a possible tie is not a clinch;
- 3rd locks before 1st;
- adding a game un-clinches;
- `winsNeeded` = 1, 2, ≥ 3;
- "any of N" vs "only Skins or Pick'em" qualifying sets;
- a live projection never locks;
- teamless units;
- a shared 1st with nothing left.

## 2 · Standings (`StandingsRows`)

- **Full names**, with the bar on its own line under the name (indented to the name's left edge).
- **Projection unchanged:** banked solid, live hatched on the same bar, solid at finalize. "If today holds" legend only while something is live (as today).
- **Locked place:** the rank number on a filled `--color-bt-text` square (18px, radius 5). Open places keep today's plain dim number. **Shared place:** "T3" on both rows.

**STOP** when this first renders. Zach looks on device.

## 3 · Points hero

Mirrors the match-play hero, tier for tier.

- **Trophy:** `ClinchCelebration` + `CupTrophy` in match play's exact placement (centred, top-anchored, cropped), `winnerSide = null` (no tilt). Opacity 0.17 gold while open → 0.3 tinted with the clincher's colour once 1st is clinched → 0.42 lit when final.
- **Middle tier (story),** where match play has the names and big scores: unit name 17/600 in team ink (when there is one), headline 30/700, dim 13 sub-line. Strings, from `vocabulary.ts`:

| When | Name | Headline | Sub-line |
|---|---|---|---|
| No game banked | — | Anyone's cup | 8 games · 32 pts in play |
| Tied at the top | — | Tied at the top | HECB & BA · 6 games left |
| Leading, `winsNeeded` ≥ 3 | leader | Lead by 2½ | 6 games left · all 4 still alive |
| `winsNeeded` = 2 | leader | Two wins from the cup | Win any 2 of the 4 left · 3 still alive |
| `winsNeeded` = 1 | leader | One win from the cup | Win any of the 3 left · … / A win in Skins or Pick'em clinches it · … |
| A live game would clinch | leader | One win from the cup | Leading Hammerschlagen · clinches if it holds |
| 1st clinched | — | 2nd is up for grabs | Hot Eagles Cold Beers clinched the cup |
| Final | winner | score (74, team colour) | Final · X wins (+ " · 3rd shared") |

After 1st locks, the ladder repeats for the highest open place ("One win from 2nd"). When a unit drops out, the sub-line says "Hack Squad is out" until the next banked game.

- **Lower tier (clinch watch, new),** in the slot match play uses for "PROJECTED · if today holds", with the same hairline divider and centred tracked label:
  - **Label:** `CLINCH WATCH · 9 pts left`, or `RACE FOR 2ND · 1 game · 3 pts left`.
  - **Track** (12px): one segment per unbanked game, flex-sized by X_g, 3px gaps. A gold post (4×24) at the end.
  - **Fill:** the lead over the closest contender, in the leader's colour with a soft glow. Hatched extension (`hatch()`) for the lead if today holds. A **dashed gold post** at `(inPlay − Σ X_live) / inPlay` marks where the line lands once the live games bank; a hatched fill past it reads "clinches if it holds".
  - **Caption:** `+4½ on Bogey Army`. Right side: a `TeamBadge` (20px) per contender for that place; an `out` unit is faded to 28%.
  - Hidden when final.
- **No burst at a clinch.** The existing clinch push is the announcement.

**STOP** when the hero first renders. Zach looks on device.

## 4 · Clinch push for points cups

Lift the Ruling 4 gate for `scoring_model = 'points'`. The clincher comes from §1, and claim and release use the existing `claim_clinch_notification` and release path, so un-clinch and re-clinch behave like match play. Teamless races behave exactly like teams (Zach): the same push, naming the person. Places 2+ send no push.

## 5 · Final and ties

- **Final** = `isCupComplete(games, hasClincher)`, **or** nothing left to play with a tie for 1st (`gamesRemaining === 0`). Show the final row of the ladder, the existing one-time spark burst on first view, and "Set off the fireworks" for the winning unit(s).
- **Ties share the place by default, 1st included.**
- **Breaking a tie** (only if the crew played a tiebreaker): a `NeedsAttentionCard` item for owners and co-owners, "Tied for 3rd · shared". It opens a `Sheet` with a `ReorderableList` of the tied units, plus **Save order** / **Keep it shared**. Nothing waits on it.
- **Migration:** `competitions.tiebreak_order text[] null`, unit ids (team ids, or user ids in a teamless race) in the order the owner set. It's read only to order units that are exactly tied at final, and has no effect on points. One column serves both kinds of race. Zach runs the migration.

---

## DO NOT

- Change two-team match-play math, hero, celebration or `winThreshold`.
- Use `pointsToClinch` / `winNumber` (the more-than-half rule) for anything in a points cup.
- Let a projection lock a place, clinch, or send a push.
- Name a "next game" or assume play order anywhere.
- Store clinch or lock state. Derive it; the only persisted pieces are the existing push claim and `tiebreak_order`.
- Add a podium, new trophy art, a tilt, or any animation at clinch time.
- Add explanatory copy beyond the strings in §3.
- Special-case teamless races: people get the same behaviour as teams everywhere.
- Skip, guard or loosen tests to get CI green.
- Run migrations against production.
