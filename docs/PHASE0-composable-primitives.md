# PHASE 0 — Composable primitives: what plugs into what, and how it ends

**2026-09-22. Investigation only. No code, no branch, no PR. Report and stop.**

**Why this comes before any Circle design.** Circles only works if the pieces a
group builds with are genuinely plug-and-play. This Phase 0 establishes which
pieces already compose, which are coupled to the container they were built for,
and where the model infers meaning it should be reading. **The design gets built
on the answer, not on the hope.**

---

## The three principles this is measured against

These are Zach's, and they are the standard for every finding below.

**1 · Plug-and-play, with compatibility the model knows.** Not everything fits
everything — you cannot put a two-sided format into a four-team cup. **But the
limits must be declared data the model can check, not rules that live in UI
conditionals or in someone's head.** A piece that silently misbehaves when
plugged into the wrong place is a failure of this principle even if the UI never
lets you do it.

**2 · Every container resolves an outcome, and the direction is declared.** A
points roll-up, a bracket, a league — each has to be able to say who won. **It can
never assume high wins.** Golf is low-wins, placement is low-wins, points are
high-wins, and `#1381` is what happens when a piece guesses.

**3 · Open-ended is a legitimate outcome kind, not a missing one.** A running
Scrabble tally between two people never ends and never needs a champion. **That
has to be a declared state — "this series is open" — not the absence of an
outcome that code has to interpret.** Empty and unknown must not render the same.

---

## Start from what this month already proved

**Do not re-derive these. Verify they still hold on current `main`, then build on
them.**

- **`#1381` — inputs must declare themselves.** The roll-up broke because
  `position ?? raw_score` treated a placement and a point score as one kind of
  number. `reconcileConvention` fixed it by making each result row declare its
  convention. **This is the pattern for every primitive: inputs describe
  themselves, and a primitive never infers what they mean.**
- **The pick'em `matchState` defect — a value true only at the terminal state,
  evaluated at every step.** `upside` was a whole-match total applied as a
  per-step ceiling. **This is the outcome-logic failure to look for everywhere:
  code that decides "it's over" using information only valid once it is.**
- **`#1304` — compatibility lives as data in `gameTypes.ts`,** checked by
  `isGameTypeForScoringModel`, which until `#1402` had exactly one caller: a
  client menu filter. **The server guard now exists for format-in-cup. The
  team-count half is held.**
- **`COMPETITION_ENGINE.md` describes a compatibility model that was designed and
  never built** — `two_team` / `multi_team` / `free_for_all`,
  `compatible_competition_formats`. **None of it exists in code or migrations.
  Do not cite it as current. But read it as a prior attempt at principle 1.**
- **Coupling already found:** `RackGameView` hard-blocks without a competition
  (`if (!tripId || !competitionId) return;`) where match and stroke do not.
  `BracketBoard`'s `<MatchCard>` is a local function (`:531`), not the shared
  card. The three bracket tables are fingerprinted by `configHash` but not
  published to realtime.
- **`rackNStack.ts` gives slots A and B to two teams only** — two-sidedness
  enforced by construction, not declaration.
- **`GAME_FORMATS.md:5–13` inverts the code-versus-docs rule on purpose**: for
  format semantics, code diverging from the doc presumptively means a code bug.
  **That rule applies to everything in this investigation.**

---

## 1 · The structures — what does each assume?

**For each of: direct matchup, bracket, points roll-up, standings over time —
and any other structure the code contains that this list misses.**

1. **What inputs does it accept, and does it read their meaning or infer it?**
   The specific question: anywhere a structure decides what a number means from
   its value, position, or the branch it's in, rather than from a declared field.
   **Name every instance of `??`, `||`, or a default doing semantic work** — that
   is where `#1381` lived.
2. **What container does it assume it sits in?** Trip, competition, team count,
   format. **List every place it reads its container to decide how to behave**,
   the way `RackGameView` reads `competitionId`.
3. **Could it accept its inputs from a different source** — played, predicted, or
   an external feed — without code changes? **The bracket is the test case:**
   could the 64-slot bracket be driven by real NCAA results as easily as by golf
   matches between participants? What would have to change?
4. **Is it reused, or duplicated?** `BracketBoard`'s local `MatchCard` is one
   instance. **Find the others** — two implementations of one structure is how
   they drift apart.

---

## 2 · Compatibility — where does the model know what fits?

1. **Every rule about what can plug into what, and where it lives.** Catalog data,
   server guards, client conditionals, compute-by-construction, docs, or nowhere.
   **The `#1304` table is the template** — extend it to every structure, not just
   format-in-cup.
2. **Which rules are declared, and which are implicit?** A declared rule is data
   the model can check. An implicit one is a UI conditional, a comment, or
   something that only fails at compute time.
3. **Which combinations fail silently rather than refusing?** A combination the UI
   hides but the server accepts, or that computes a wrong answer instead of an
   error. **Those are the ones principle 1 exists to catch.**
4. **What would a compatibility declaration need to express?** Report the actual
   dimensions the existing rules vary on — sidedness, team count, scoring
   direction, result source — **rather than proposing a schema.** The dimensions
   are the finding; the design is later.

---

## 3 · Outcomes — how does each container end?

1. **For each structure: how does it decide a winner, and where is the direction
   encoded?** High-wins, low-wins, placement, win/loss/halve. **Name every place
   direction is assumed rather than read** — golf's low-wins is the one most
   likely to be hardcoded somewhere it shouldn't be.
2. **Decided versus final.** Clinch means the outcome is known before the
   container is complete. **For each structure, is "decided" computed separately
   from "complete", and is decided ever computed from terminal-only information?**
   That is the `matchState` failure mode.
3. **Ties, halves, and all-square.** How each structure represents a tie, and
   whether a tie is a declared outcome or an absence of one. **The `AS` chip at
   2.95:1 rendering on every unplayed match is the example** — all-square before
   anything has happened looks identical to all-square as a result.
4. **Tiebreakers.** Where they exist, whether they're declared, and what happens
   when there are none.
5. **Open-ended.** **Does anything today support a container with no terminal
   state?** If a series simply runs, what does the code do when asked "who won"?
   **Report whether open-ended is expressible, or whether it can only be faked by
   never finalizing** — the second is the empty-versus-unknown problem again.

---

## 4 · Answer `#1304`'s held decisions as a by-product

These were parked because they depend on what a competition becomes. **This
investigation should make them answerable:**

1. **A match game in a cup without exactly two teams** — `GAME_FORMATS.md` §6
   calls it a supported fallback to the whole trip crew; `#1304` and a
   `StrokeGameView` comment call it a state that should not exist. **Under the
   composable model, which is it?** Note that §6's fallback is also the
   standalone-game path, which a decoupled model makes the main path.
2. **`teams.delete` below two teams on a match-play cup.**
3. **Non-golf "Matches" in N-team cups** — two-sided, allowed anywhere, zero in
   production.

**Do not decide them. Report what the evidence implies.**

---

## Out of scope — and say so if the evidence pulls toward it

- **The Circle schema and RLS migration.** `trip_id` is `NOT NULL` on both tables
  and RLS gates on `is_trip_member`. **That is its own Phase 0** and it is the
  expensive one.
- **External data feeds** — tournament results, player stats. Report what each
  structure would *need* from a feed; do not investigate feeds.
- **Prediction beyond pick'em.** Pick'em is the one prediction source that exists.
  Report how it is wired; do not design March Madness.
- **Any UI.** The IA gets designed against this report, not alongside it.

---

## What to report

1. **The structure table** — each structure, its inputs, what it infers, what
   container it assumes, whether it's reused or duplicated.
2. **The compatibility table** — every rule, where it lives, declared or implicit,
   and which combinations fail silently.
3. **The outcome table** — each structure's winner logic, direction, decided vs
   final, ties, tiebreakers, and whether open-ended is expressible.
4. **The dimensions** compatibility actually varies on, as found.
5. **`#1304`'s three decisions**, with what the evidence implies for each.
6. **A ranking**: which structures are already plug-and-play, which need
   loosening, and which are coupled enough that the Circle model can't lean on
   them yet.
7. **Confidence limits.** This month's record is that code reading misfires —
   `#1250`'s misdiagnosis and `#1361` never being true both came from rung 1.
   **Mark every finding with how it was established**, and flag which ones would
   need a run to confirm.

---

## DO NOT

- **Do not write code, open a branch, or open a PR.**
- **Do not propose a schema.** Report dimensions, not tables.
- **Do not fix a coupling you find.** Report it with file and line.
- **Do not cite `COMPETITION_ENGINE.md` as describing current behaviour.**
- **Do not decide `#1304`'s held decisions.** Report what they imply.
- **Do not open issues.** Several findings will be instances of things already
  filed; that gets sorted after the report is read.

---

## Code versus documentation

Verify every behavioural claim against `src/` and `supabase/migrations/` — not
against `CLAUDE.md`, `STYLE_GUIDE.md`, `GAME_FORMATS.md`, `PERMISSIONS.md`,
`COMPETITION_ENGINE.md`, or this brief. **Several claims above come from this
month's reports and have not been re-checked since.**

**If the code and a document disagree, that is a finding to report — not a
discrepancy to resolve.** Quote both, name the file and line for each, and stop.

**Exception, stated in the doc itself:** `GAME_FORMATS.md:5–13` — for format
semantics, code diverging from the doc presumptively means a code bug.

## When a rule blocks you

If a rule in `CLAUDE.md` or a constraint here blocks the obvious path, **say so
before complying.** Name the rule, what it prevents, and the straightforward
alternative.

## Issue hygiene

**Open nothing during this investigation.** Findings go in the report. **Prefer an
instance on an existing issue over a new sibling** when this is sorted afterward.
