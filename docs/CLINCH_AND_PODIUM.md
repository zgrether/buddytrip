# Points Cups: Clinch Watch & Place Locks (build spec, v2.2)

*Scope: Workflow Wireframes canvas, row 6 only (boards F0–F4). Companion to `COMPETITION_ENGINE.md`.*
*Designed 2026-11-03 → 05. v2 folds in the Phase 0 report and Zach's rulings (2026-11-05); v2.1 folds in the §1–§2 build report; v2.2 folds in the §3 build rulings (lo = 0, winsNeeded, label, ladder, copy). Model: Opus. One branch, per-task commits.*

**Mockups:** `docs/mockups/points-clinch/` (`index.html` with all five boards live, plus a PNG per board). They are the visual target. **The spec governs behaviour:** where they disagree, the spec wins, and you report it. The trophy there is a static port; use `CupTrophy` and the tokens.

**Guiding rule.** A scorekeeping app first. A clinch is a clear *state* on the board, not a show. Celebration waits until nothing is left to play.

**Reuse rule.** Don't duplicate `CupTrophy`, `ClinchCelebration`, `StandingsRows` (+ `hatch()`, `PERSON_COLOR`), `TeamBadge`, `Avatar`, `Sheet`, `ReorderableList`, `NeedsAttentionCard`, or the clinch push and claim. New UI is only the clinch watch and the place-lock chip.

**Gate:** `scoring_model === 'points'` (not `!isRace`; a half-built match-play cup is also `!isRace`). Units = teams, or people in a teamless race. **People behave exactly like teams everywhere.**

**Prior rulings this reverses:**
1. Standings rows become a **subject** slot, so full names. Update STYLE_GUIDE "Team names — subject slots vs label slots" in the same PR.
2. `gameFinishNotify` "Ruling 4: head to head owns CUP clinch": points cups now fire a clinch too, **from §1 only**, never from `pointsToClinch`.
3. Glossary: points-based is "Tournament". **Exception for now:** this feature's strings say "cup" (Zach; the glossary may change later). Don't route them through `competitionWord`.

---

## 1 · The math: new pure module (e.g. `lib/pointsClinch.ts`)

**Per-unit bound per unbanked game g:** `hi_g(T)`, the most T can earn. The least is always 0 (Zach, v2.2): a team whose players don't finish gets no result row, so any floor above 0 could lock early.

| Format | `hi_g(T)` |
|---|---|
| Placement (stroke, Stableford, scramble, skins, manual) | top award |
| Pick'em; game with no split | `points_total` |
| Match play, Matches | before the game starts: the whole total (pairings can change). After: Σ points of T's matches + unpaired points |
| Bracket | before it starts: the whole total. After: Σ top-k awards, k = T's entrant count |

```
swing(A, B)     = Σ over unbanked g of hi_g(B)                 // most B can gain on A
safe(A over B)  = pts(A) − pts(B) > swing(A, B)               // strict: a possible tie is not safe
placeLocked(T)  = every unit above T is safe over T  AND  T is safe over every unit below T
clincher        = the 1st-place unit, if placeLocked(it)
out(T, p)       = at least p units are safe over T             // T can no longer finish p-th or better
```

- **Never early**, proven by playing every outcome of the games left through the real award functions. Accepted late-never-early cases: brackets where teammates can't meet, matches between teammates.
- Banked points only (`bankedOnlyWhenFinished`). A game reopened for a correction stays banked (existing ruling: corrections don't un-clinch or re-announce).
- **Derived, never stored.** Adding a game raises the swing, so a lock reverts by itself.

**winsNeeded(L):** 1, 2, or null (null = 3 or more), **for 1st only**. Check single games, then pairs: does L winning g (or g and h) guarantee L is safe over every chaser in every finish? A win counts only what it is certain to give:
- **Every chaser** takes the best award left in that game, since any of them could come second.
- **Match games:** L is credited only its own matches; a chaser keeps the matches it plays elsewhere, plus any unpaired points. A match game that hasn't started can't be a qualifying win (no pairing to win).
- **Brackets:** a win is 1st place alone, however many entrants L has.

O(n²), bounded for any cup size, order-free (never names a "next game"). It has the same played-out proof as the locks: every game `winsNeeded` names clinches in every finish where the leader wins it.

**Tests:**
- strict clinch; a possible tie is not a clinch;
- a 4-3-2-1 split swings the full 4; a team that doesn't finish gets no row and can't fool a lock;
- 3rd locks before 1st;
- `out` on F2 (no chaser is out of 2nd);
- adding a game un-clinches;
- `winsNeeded` 1 / 2 / null, "any of N" vs "only Skins or Pick'em", the [5,4,1] case (a win that only clinches if the chaser comes last is not a win), match and bracket wins;
- a live projection never locks;
- bracket and match-play bounds;
- teamless units;
- a shared 1st with nothing left;
- a reopened game.

## 2 · Standings (`StandingsRows`)

- **Full names.** The bar goes on its own line under the name, indented to the name's left edge. Long names wrap (34 max, so 2 lines at most).
- **Shared 1st:** every tied leader row uses the big leader number.
- **Projection unchanged:** banked solid, live hatched, solid at finalize. "If today holds" legend only while something projects.
- **Locked place:** the rank number on a filled `--color-bt-text` square (18px, radius 5). Open places: today's dim number. **Shared:** "T3" on both rows.
- Points use `fmtPts`, so decimals ("2.5"), per the 2026-10-22 rule.

**STOP** when this first renders. Zach looks on device.

## 3 · Points hero

Mirrors the match-play hero tier for tier. The pinned bar and the game-page header don't change.

- **Trophy:** `ClinchCelebration` + `CupTrophy` in match play's exact placement, `winnerSide = null`. Opacity 0.17 gold while open → 0.3 tinted once 1st is clinched → 0.42 lit when final.
- **Middle tier (story):** unit name 17/600 in team ink, headline 30/700, dim 13 sub-line. Strings go in `vocabulary.ts`; all numbers go through `fmtPts`:

| When | Name | Headline | Sub-line |
|---|---|---|---|
| No game banked | — | Anyone's cup | 8 games left |
| Tied at the top | — | Tied at the top | HECB & BA · 6 games left |
| Leading, `winsNeeded` null | leader | Lead by 2.5 | 6 games left · all 4 still alive |
| `winsNeeded` = 2 | leader | Two wins from the cup | Win any 2 of the 4 left · 3 still alive, **only if every pair qualifies**; otherwise 4 games left · 3 still alive |
| `winsNeeded` = 1, several games | leader | One win from the cup | Win any of the 3 left · … / A win in Skins or Pick'em clinches it · … |
| `winsNeeded` = 1, one game left | leader | One win from the cup | A win in Skins clinches it |
| A projecting live game would clinch at today's numbers | leader | (whatever the ladder says; never forced to "One win") | Leading Stableford · clinches if it holds |
| 1st clinched, a place still open | — | 2nd is up for grabs | Hot Eagles Cold Beers clinched the cup |
| Every place locked, games still open | clincher | Clinched the cup | Every place is set · 1 game left (count dropped if only a correction is open: "Every place is set") |
| Final | winner | score (74, team colour) | Final · X wins (+ " · 3rd shared") |
| Final, shared 1st | "Hot Eagles Cold Beers & Bogey Army" in plain text colour | score | Final · Shared 1st |

- The team-specific ladder is **1st only**. An open place below 1st always reads "{place} is up for grabs" / "{clincher} clinched the cup". There is no "One win from 2nd".
- When a unit drops out of contention for 1st (`out(T, 1)`), its name replaces the alive count until the next banked game: "6 games left · Hack Squad is out".

- **Lower tier (clinch watch),** in match play's "PROJECTED" slot, with the same divider and centred tracked label:
  - **Label:** `CLINCH WATCH · 3 games left`; below 1st, `CLINCH WATCH · 2ND · 2 games left`. One label for every place ("race" is retired vocabulary; the guard stays untouched). Games left = unbanked games.
  - **Track** (12px): one segment per game left, flex-sized by `hi_g(closest contender)`, 3px gaps. Gold post (4×24) at the end.
  - **Fill:** the lead over the closest contender ÷ `swing(leader, chaser)`, in the leader's colour with a soft glow. Reaching the post = locked.
  - **Projection:** only for formats that project (manual games never do). The hatched extension shows the lead if today holds. A **dashed gold post** marks where the line lands once the live games bank.
  - **Caption:** `+4.5 on Bogey Army`. Right side: a `TeamBadge` (20px) per contender; an `out` unit is faded to 28%.
  - Hidden when final.
- **No burst at a clinch.** The push is the announcement.
- **People:** fill and post use `PERSON_COLOR` (accent); badges use `Avatar`.

**STOP** when the hero first renders. Zach looks on device.

## 4 · Clinch push

- Lift the Ruling 4 gate for points cups. The clincher comes from §1. Claim and release work as in match play.
- **Migration:** `competitions.clinch_notified_user_id text null` (FK users; `users.id` is text). At most one of team/user is set (check constraint). The teamless claim uses it.
- Places 2+ send no push.

## 5 · Final and ties

- **Final (points cups)** = `gamesRemaining === 0` (no unbanked game, none open for correction). It does not use `isCupComplete`: with 1st clinched and unarmed games left, `isCupComplete` would fire while places are still open. An abandoned game is deleted (the app has no "dropped" state). Final shows the Final row(s) of the table, the existing one-time spark burst on first view, and "Set off the fireworks" for the winning unit(s).
- **Ties share the place by default, 1st included.**
- **Breaking a tie:** a `NeedsAttentionCard` item for Owner and Organizers, "Tied for 3rd · shared". It opens a `Sheet`:
  - Title: **Break the tie for 3rd?**
  - Body: **Played a tiebreaker? Drag to set the order. Left alone, they share 3rd.**
  - A `ReorderableList` of the tied units, then **Save order** / **Keep it shared**.
  - Nothing waits on it.
- **Migration** (same file as §4): `competitions.tiebreak_order text[] null`, unit ids in the order the owner set, read only to order exact ties at final. Add both new user-id references (`clinch_notified_user_id` and `tiebreak_order` entries) to `merge_guest_to_real_user`. Zach runs the migration.

---

## DO NOT

- Change two-team match-play math, hero, celebration, `winThreshold` or `isCupComplete`.
- Use `pointsToClinch` / `winNumber` for anything in a points cup.
- Let a projection lock a place, clinch, or send a push.
- Name a "next game" or assume play order.
- Store clinch or lock state beyond the push claim and `tiebreak_order`.
- Add a podium, new trophy art, a tilt, or animation at clinch time.
- Add copy beyond the strings above, or route these strings through `competitionWord` (ruling 5: "cup" exception).
- Special-case teamless races.
- Skip, guard or loosen tests to get CI green.
- Run migrations against production.
