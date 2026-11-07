# Points Cups: Clinch Watch & Place Locks (build spec, v2.10)

*Scope: Workflow Wireframes canvas, row 6 only (boards F0–F4). Companion to `COMPETITION_ENGINE.md`.*
*Designed 2026-11-03 → 05. v2 folds in the Phase 0 report and Zach's rulings (2026-11-05); v2.1 folds in the §1–§2 build report; v2.2 folds in the §3 build rulings (lo = 0, winsNeeded, label, ladder, copy); v2.3 folds in the empty-board ruling and the §5 build; v2.4 folds in the tiebreak build report; v2.5 changes the empty-board copy; v2.6 drops the correction-clears-review rule; v2.7 moves ties into the reveal and celebrates a tie; v2.8 makes decision points open themselves; v2.9 records the text-over-art treatment; v2.10 replaces the locked-place chip with place ribbons. Model: Opus. One branch, per-task commits.*

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
- **Locked place (v2.10, place ribbons):** a locked place earns its ribbon.
  - **1st–3rd:** a prize rosette in gold / silver / bronze metal (scalloped disc, two tails, rank number engraved in the darker metal), about 24×32 in a 26px rank slot. Metal colours, never team colours, so they can't clash. One small shared `PlaceRibbon` component (SVG), with an aria-label like "2nd place, locked".
  - **4th and below, locked:** the rank number in a quiet outlined square (1.5px `--color-bt-text-dim` border, no fill).
  - **Open place:** today's plain dim number.
  - **Shared place:** both rows get the same ribbon (two gold rosettes for a shared 1st); no "T1" text needed when the place is locked. An open tie keeps "T1" as plain dim text.
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
| Final, shared 1st | "Centurions & Spartans", each name in its own team colour, "&" in text colour | score (74, plain text colour) | **It's a tie!** (20/800, full-strength text colour, replaces the Final line) |

- The team-specific ladder is **1st only**. An open place below 1st always reads "{place} is up for grabs" / "{clincher} clinched the cup". There is no "One win from 2nd".
- When a unit drops out of contention for 1st (`out(T, 1)`), its name replaces the alive count until the next banked game: "6 games left · Hack Squad is out".

- **Lower tier (clinch watch),** in match play's "PROJECTED" slot, with the same divider and centred tracked label:
  - **Label:** `CLINCH WATCH · 3 games left`; below 1st, `CLINCH WATCH · 2ND · 2 games left`. One label for every place ("race" is retired vocabulary; the guard stays untouched). Games left = unbanked games.
  - **Track** (12px): one segment per game left, flex-sized by `hi_g(closest contender)`, 3px gaps. Gold post (4×24) at the end.
  - **Fill:** the lead over the closest contender ÷ `swing(leader, chaser)`, in the leader's colour with a soft glow. Reaching the post = locked.
  - **Projection:** only for formats that project (manual games never do). The hatched extension shows the lead if today holds. A **dashed gold post** marks where the line lands once the live games bank.
  - **Caption:** `+4.5 on Bogey Army`. Right side: a `TeamBadge` (20px) per contender; an `out` unit is faded to 28%.
  - Hidden when final.
- **Text over the lit trophy (v2.9, measured at 390px in both themes):** a team-coloured name or score over the bowl gets the *over-art* treatment, tokens set per theme in `globals.css`. **Ink:** the team colour moved away from the bowl (40% toward white in dark, 45% toward black in light). **Halo:** a text glow in the card's own tone. It applies to the winner's name line and the single winner's 74px score. The tied score stays plain text colour. Before Final the trophy is faint, so nothing changes there.
- **No burst at a clinch.** The push is the announcement.
- **People:** fill and post use `PERSON_COLOR` (accent); badges use `Avatar`.

**STOP** when the hero first renders. Zach looks on device.

## 4 · Clinch push

- Lift the Ruling 4 gate for points cups. The clincher comes from §1. Claim and release work as in match play.
- **Migration:** `competitions.clinch_notified_user_id text null` (FK users; `users.id` is text). At most one of team/user is set (check constraint). The teamless claim uses it.
- Places 2+ send no push.

## 5 · Final and ties

**The empty board (Zach, 2026-11-06).** A crew may add games as it plays, so the moment the board empties is ambiguous: it's either the real end, or just the end of what's been added so far. Only the owner knows.

- **The finish that empties the board** (`gamesRemaining` hits 0) sends nothing and doesn't go Final.
- **Decision points open themselves (Zach, v2.8).** For Owner and Organizers, a `Sheet` **opens automatically** when they arrive at the cup page: **"All games are in. Head to the winner's circle?"**, with **[To the winner's circle]** and **[Add another game]** (the add-game flow; the cup stays open). Same wording for one winner or a shared 1st.
  - It opens **once per visit** to the cup page (not on re-renders or tab switches within the visit), and keeps doing so on each visit until they decide.
  - **✕ without deciding:** the same ask sits **expanded** in `NeedsAttentionCard` (question + both buttons) for the rest of the visit. "Needs attention" is the fallback, never the primary surface for a decision.
  - Members never get the sheet; their hero reads "All games are in".
- **While it waits:** the hero reads **"Lead by 4" · "All games are in"** (or "Tied at the top"). A clinch that was already announced stays "Clinched the cup". No place shows locked: with an empty board the math would call everything locked, and that's exactly the claim we're waiting on.
- **A clinch while games remain on the board** pushes as in §4.
- **To the winner's circle, with ties: decide before declaring.** If any tie exists, the **same sheet moves to a tie step** before Final:
  - Title: **"Tied for 1st"** / **"Tied for 3rd"**; **"Ties"** when there are several (each tie is then a section).
  - Body: **"Played a tiebreaker? Drag to set the order."**
  - Buttons: **Use this order** / **Keep it a tie**. Both save `tiebreak_order` and continue to Final. ✕ cancels without crowning (it falls back to the expanded "Needs attention" ask).
  - No ties: straight to Final.
- **The button shows the app's pending state** while the save is in flight.
- **To the winner's circle** writes `competitions.status = 'completed'` (existing column, no new one). It goes Final, sends the push once (a clinch already announced isn't sent again), then scrolls the hero into view. **The burst plays once on the device that crowned** (whatever team the owner is on), and on each winner's first view; "Set off the fireworks" stays winners-only. A shared 1st uses gold sparks.
- **Adding a game to a finished cup reopens it.** The next emptying asks again.
- **Migration 225** marks the already-finished points cups (BBMI 2024, BBMI 2025, and the teamless test cup) completed, so they stay Final and never ask. Apply it before #1696 merges, from the branch (`main` doesn't have 224 yet).

**Ties**
- **Ties share the place by default, 1st included.** A shared 1st at Final **sends a push**: "It's a tie! {A} and {B} share {cup name}". Guarded by the status flip to `completed`, because the clinch claim holds one unit.
- **After Final, a kept tie** shows in `NeedsAttentionCard` as an optional follow-up, **"Tied for 1st · shared"** (opens the tie sheet, for a tiebreaker played later). It's no longer a decision point, so it doesn't open itself. Clears once an order is saved.
- **STYLE_GUIDE (same PR):** add the rule. A decision point opens as a modal for whoever has to decide, and stays primary until they decide. `NeedsAttentionCard` holds what was dismissed without deciding, and optional follow-ups.
- **Both answers are a decision and both are saved.** `tiebreak_order` null = not yet reviewed. Non-null = reviewed. It lists the ids of the groups the owner ordered; a tied group whose ids are absent stays shared, and `[]` means every tie was kept shared. With several tied groups, one sheet covers them all.
- **Reopenable:** at Final, ⚙ (cup settings) has **"Tiebreaks"** whenever ties exist, opening the same sheet with the saved order.
- **The review is cleared** (`tiebreak_order` → null, so the next reveal asks again) when the cup reopens: adding a game, or either reset path. A correction to a finished cup does **not** clear it (v2.6). A new tie it creates is shared by default and shows as T-ranks, an old order only ever applies to an exact tie so it can't misorder the new one, and the tie stays reachable from ⚙ Tiebreaks.
- **Several ties:** the sheet is titled **"Ties"**, and each tie is a section. Save order: with one tie, it saves what's on screen; with several, only the ties that moved plus any already saved, and it's disabled until something moves.
- **Refusals:** "Nothing is tied anymore." / "That tie has changed. Open Tiebreaks again."
- **A broken 1st sends the push only if nothing was announced yet.** Changing it afterwards sends nothing (accepted: the crew is together when tiebreaks are set). Breaking a tie below 1st never runs the clinch check.
- **A tie for 1st broken at Final** makes that unit the winner and sends the push once, through the normal claim.
- **Migration** (224, applied): `competitions.tiebreak_order text[] null` and `clinch_notified_user_id text null`, both in `merge_guest_to_real_user`.

---

## DO NOT

- Change two-team match-play math, hero, celebration, `winThreshold` or `isCupComplete`.
- Use `pointsToClinch` / `winNumber` for anything in a points cup.
- Let a projection lock a place, clinch, or send a push.
- Name a "next game" or assume play order.
- Store clinch or lock state beyond the push claim, `tiebreak_order`, and `status = 'completed'` from To the winner's circle.
- Add a podium, new trophy art, a tilt, or animation at clinch time.
- Add copy beyond the strings above, or route these strings through `competitionWord` (ruling 5: "cup" exception).
- Special-case teamless races.
- Skip, guard or loosen tests to get CI green.
- Run migrations against production.
