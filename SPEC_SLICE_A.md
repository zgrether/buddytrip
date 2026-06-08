# CC Spec — Slice A: Individual Stroke-Play Spine

*Design reference: `COMPETITION_ENGINE.md`. Read it first, plus `CLAUDE.md`,
`STYLE_GUIDE.md`, `PERMISSIONS.md`.*
*Model: **Sonnet** — single vertical, no architectural branching.*

---

## Goal

The first vertical of the gaming engine, end to end: create an **individual
stroke-play** game, enter per-hole strokes in a grid, compute results, finish.
This hardens the four spine tables and the StandardGrid renderer on the simplest
possible case **before** sides, teams, matches, handicap, or modifiers exist.

Demoable on its own: a tester can play a full 18-hole individual stroke-play
round and see final standings.

**In scope:** gross individual stroke play only. One score per user per hole.
Low total wins.

**Explicitly NOT in scope** (these come in later slices — do not build, do not
stub logic for them):
- play_groups, sides, foursomes
- competition, teams, `game_matches`, points
- handicap / Buddy Rules / net scoring (Slice F)
- Stableford, match play, skins, rack-n-stack, any non-`stroke_total` strategy
- modifiers (glorious holes, moving tees), `games.config` logic
- the full Games tab (Slice E) — a minimal create entry point only
- Quick Game ⚡ (see "Follow-up", below — likely a separate slice A2)

---

## Tasks (commit after each)

### Task 1 — Migration: spine tables

Create `games`, `game_participants`, `score_entries`, `game_results` per the v1
data model in `COMPETITION_ENGINE.md`. Notes:

- All PKs/FKs are `text` (project convention — uuid FK → text PK errors).
- **Context FK columns** (`competition_id`, `team_id`, `play_group_id`) are
  created **nullable `text` with NO `REFERENCES` constraint yet** — their parent
  tables don't exist until later slices. Add the FK constraints in the slice that
  creates each parent. (`course_id` → `circle_courses` *may* reference the
  existing stub table; it is unused in Slice A — nullable is fine.)
- `config jsonb DEFAULT '{}'`, `modifiers jsonb DEFAULT '{}'`,
  `annotations jsonb DEFAULT '{}'` (on `score_entries`) — created but unused in A.
- `games.status` CHECK in (`'pending'`,`'active'`,`'complete'`).
- `score_entries.participant_type` CHECK in (`'user'`,`'play_group'`); A only
  writes `'user'`.
- `game_results.entity_type` CHECK in (`'user'`,`'team'`,`'play_group'`); A only
  writes `'user'`.
- `UNIQUE(game_id, participant_id, unit_label)` on `score_entries`.
- Plain `CREATE INDEX` on the `game_id` FKs (small tables — CONCURRENTLY not
  needed; per CLAUDE.md it can't run in a migration transaction anyway).
- **Migration number: verify the current max in `supabase/migrations/` and use
  the next sequential number — do not assume. No gaps.**
- RLS: SELECT for any trip member; INSERT/UPDATE gated to match the tRPC gate
  decided in Task 3 (RLS as backstop, equal-or-looser per the existing audit).

### Task 2 — `game_type_templates`: stroke-play row

- Add the engine columns from `COMPETITION_ENGINE.md` if absent: `entry_schema`,
  `result_strategy`, `supports_free_for_all`, `supports_sides`, `requires_sides`,
  `max_players_per_side`, `compatible_competition_formats text[]`,
  `compatible_modifiers text[]`, `config_schema jsonb`, `scorecard_schema jsonb`.
- Ensure a clean **stroke play** template row: `entry_schema='user_holes'`,
  `result_strategy='stroke_total'`, `supports_free_for_all=true`,
  `requires_sides=false`, and a `scorecard_schema` for 18 holes
  (`units.type='holes'`, `count=18`, `metadata.par`), `scoring.direction='low_wins'`,
  `aggregation='sum'`, front/back-9 sections.
- Do **not** re-seed or rename the other placeholder templates here — that's a
  separate task. Touch stroke play only.

### Task 3 — tRPC `games` router

Procedures: `create`, `getById`, `addParticipants`, `listByTrip`.
- `create({ tripId, gameTypeId, name })` → inserts a `games` row
  (`competition_id` null, `status='pending'`). Use the RLS INSERT/SELECT split
  pattern (CLAUDE.md pattern #4).
- `addParticipants({ gameId, userIds })` → 2–4 `game_participants`,
  `participant_type='user'`, `play_group_id`/`team_id` null.
- `getById` / `listByTrip` → `requireTripMember`.
- **OPEN DECISION (confirm before building — do not guess):** what role gates
  `create`/`addParticipants`? Casual-game ethos suggests `requireTripMember`
  (any member); trip-structured work is usually `Organizer`+. Defaulting to
  `requireTripMember` pending confirmation. Flag, don't silently pick.
- Vitest unit test for the router (CLAUDE.md testing rule).

### Task 4 — Score entry mutation

`scores.upsertEntry({ gameId, participantId, unitLabel, value })`:
- `participant_type='user'`, `submitted_by = auth user`, `submitted_at = now()`.
- Upsert on the UNIQUE key.
- **Any trip member in the game may enter scores for any participant.**
  `submitted_by` is audit/informational only — **never** a permission gate
  (engine decision #7).
- Optimistic update with rollback (CLAUDE.md pattern #1); explicit cache
  generics (pattern #2).
- Vitest test.

### Task 5 — Result computation: `stroke_total`

`computeStrokePlayResults(gameId)`:
- Sum each participant's `score_entries.value` (gross — no handicap in A).
- Write one `game_results` row per user: `entity_type='user'`,
  `raw_score = total`, `position` by ascending total (ties share position),
  `competition_points_earned = null`.
- Pure, unit-tested function; called on Finish (Task 7). Idempotent
  (recompute replaces prior rows for the game).

### Task 6 — StandardGrid renderer (reusable, persistence-agnostic)

React component, the Tier-3 scorecard. Build it generic so later slices reuse it.
- Props: `units` (from `scorecard_schema`), `participants`, `values`,
  `onChange(participantId, unitLabel, value)`, `direction`.
- Rows = participants, cols = the 18 holes, editable integer cells.
- Front-9 / back-9 subtotals + grand total per row; low-wins direction cue.
- **Styling: read `STYLE_GUIDE.md` first.** Use `var(--color-bt-*)` tokens only —
  no hardcoded hex. Surface hierarchy per Section 1; buttons per Section 5.
  Mobile-first, large tap targets.
- No persistence inside the component — it takes data and emits changes.
- Playwright happy-path E2E (CLAUDE.md): create → enter all scores → finish →
  standings.

### Task 7 — Minimal game flow UI

- A minimal "New stroke-play game" entry point (temporary — the real Games tab
  is Slice E): pick 2–4 players from the trip crew, create, open the StandardGrid.
- Live total updates as scores are entered.
- "Finish" → `status='complete'`, run Task 5, show final standings (ordered by
  position). Keep copy plain (STYLE_GUIDE / project copy preferences).

---

## Follow-up (NOT Slice A — confirm before bundling)

**Quick Game ⚡ (A2):** the title-bar easy button — golf → stroke play → pick
players → score → "play again / discard". Reuses the **same StandardGrid** but
backed by **local storage, no DB row** (engine decision #14). Pure frontend, no
migration. Highest tester value with zero setup, but it does not exercise the DB
spine — so it rides *after* A, reusing A's renderer. Recommend a separate small
commit/slice; pull into A only if you'd rather ship the tester-facing piece first.

---

## "Done" (per CLAUDE.md)

1. Feature implemented (Tasks 1–7).
2. Vitest (router + computation) and Playwright (happy path) written and passing.
3. Committed per task with clear messages.
4. `npx tsc --noEmit` clean.
5. No console errors in the browser.
6. New patterns documented in `CLAUDE.md` with a concrete codebase reference
   (e.g. the persistence-agnostic renderer pattern, the result-computation
   function shape) — per the standing rule that a correct new pattern ships with
   a CLAUDE.md note.

---

## Open decisions to resolve before CC starts

1. **Game-creation permission gate** (Task 3) — `requireTripMember` vs
   `Organizer`+.
2. **Quick Game placement** — in Slice A or a separate A2.
3. **Migration number** — CC verifies the current max (do not hardcode).
