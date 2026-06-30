# CC SPEC — Competition Creation: PHASE 0 Diagnosis (true-state report)

**Diagnose-only.** Maps current state with file:line evidence. No code, migrations, or
app-file changes were made. Live-DB inspection (#6, #10) was read-only via Supabase MCP
(project `nezhuwyfirrbmyojpiyx`, "BuddyTrip").

> **Headline correction to the spec's premise.** The app does **NOT auto-create a
> competition with hardcoded defaults**. Competition creation is an **explicit,
> user-initiated flow** (a "Set it up" card → intro panel → a name/tagline form → an
> explicit `competitions.create` mutation). What *is* hardcoded is the **two placeholder
> teams** seeded inside `create` (Team A / Team B, fixed hex). And `scoring_model` is never
> written by the create path, so it falls to the DB default `match_play` — which is the real
> reason "every competition is born match_play." So the new flow replaces an *explicit*
> create form, not an auto-creator. This reframes #1, #2, and #7 below.

---

## 1. What creates a competition today — the trigger

**No auto-creation anywhere.** Creation is a deliberate chain:

1. **Trip-side entry button** — `CompetitionEnableCard` ("Running a competition?" → **"Set it
   up"**) at `src/app/trips/[tripId]/components/setup-guide/CompetitionEnableCard.tsx:86`,
   `router.push('/trips/${tripId}/leaderboard')`. It lives in the owner-only `FreshTripGuide`
   (`.../setup-guide/FreshTripGuide.tsx:261`). The trip page's `onEnableComp` does the same
   push (`src/app/trips/[tripId]/page.tsx:447`), as does the trip-nav "Competition" jump
   (`page.tsx:260`). **None of these create anything — they only route to the Live face.**
2. **The Live face** (`/trips/[tripId]/leaderboard/page.tsx` → `LiveFaceClient`). When there is
   no competition row and the viewer `canEdit`, it shows `CompetitionIntroPanel`
   (`LiveFaceClient.tsx:182-190`). Its "Enable Competition Mode" button
   (`CompetitionIntroPanel.tsx:95`) **does not create** — it flips a local `unlocked` flag
   (`LiveFaceClient.tsx:69,186-189`) that swaps in `CompetitionSetupPanel`.
3. **The create form** — `CompetitionSetupPanel` "Create Competition"
   (`CompetitionSetupPanel.tsx:105`) calls **`competitions.create`**
   (`src/server/routers/competitions.ts:178`).

**Engine decision #12 ("Enable competition? when 2+ games exist" nudge) — CUT: `confirmed`.**
`COMPETITION_ENGINE.md:550` and `:600` both state the nudge was cut and there is no
standalone→competition conversion. Its replacement is the explicit "Set it up" entry above
(the Stage-5 "cord-cut" described in `CompetitionEnableCard.tsx:8-22`).

**Divergence flagged:** spec says "AUTO-CREATES … skips the chooser flow entirely." Actual:
explicit create, no chooser yet (the chooser is exactly what's missing — see #4).

---

## 2. What it hardcodes — the values

The `create` mutation (`competitions.ts:205-230`) inserts **only** `trip_id`, `name`,
`tagline`. Everything else is DB default:

- **`competitions.scoring_model`** — **NOT written in code.** Falls to the column default
  `'match_play'` (`supabase/migrations/...062_competitions_scoring_model.sql:27`; live default
  confirmed `'match_play'::text`). So `match_play` isn't hardcoded in the mutation — it's the
  unavoidable default because nothing ever sets it. *(prior audit `confirmed`, with the nuance
  that it's a DB default, not a literal in `create`.)*
- **`competitions.format`** — **column does not exist (`not found`).** The engine doc's format
  taxonomy (`free_for_all` / `two_team` / `multi_team`, `COMPETITION_ENGINE.md:242-250`) and
  its `sides_are_teams=true` were **never built**. The shipped axis is `scoring_model` only.
  Read nowhere because it doesn't exist.
- **Two `teams` rows seeded** (`competitions.ts:227-230`), hardcoded:
  | name | short_name | color | color_dim |
  |------|-----------|-------|-----------|
  | Team A | A | `#3b82f6` (blue) | `#0a1a2a` |
  | Team B | B | `#ef4444` (red) | `#2a0a0a` |
  The hardcoded hex is at **`competitions.ts:228-229`** — prior audit said "~228": `confirmed`.
  Best-effort insert (a seed failure does not block creation — `competitions.ts:224-226`).
- **`competition_games.points_distribution` / `sides_are_teams`** — **`not found`.** There is no
  `competition_games` table; games are a separate `games` table with a `competition_id` FK, and
  **no game is created at competition creation.** `points_distribution` (jsonb, tagged
  `per_match`/`placement` — migrations 043/048) and `points_total` (migration 049) are **per-game**
  columns set later in the add-game flow, not seeded here. `sides_are_teams` exists in neither
  the schema nor `src/` (grep-empty) — design-doc-only, unbuilt.
- **`competition_team_members` seeded?** — **No table by that name; teams start EMPTY.** The
  roster table is `team_assignments` (`migrations/...001:team_assignments`). `create` seeds the
  two teams but **no assignments** — rosters are built later in the Rosters overlay
  (`competitions.ts:224-226` comment confirms "teams up front, rosters not").

**Divergence flagged:** the spec's table names (`competition_teams`, `competition_games`,
`competition_team_members`) are engine-doc names. The shipped schema is `teams` /
`games(competition_id)` / `team_assignments`.

---

## 3. Team count — how it's determined

- **No stored count field.** Team count = number of `teams` rows. The leaderboard reads
  `teams.length` (`CompetitionLeaderboard.tsx:184` for the empty state, `:244` for the board
  shape). `confirmed`.
- **Nothing hardcodes "2" as a constraint.** `create` *seeds* 2 (`competitions.ts:227`), but
  no count cap exists.
- **Add/remove-team mutations exist and are not auto-stub-only:**
  - `teams.create` (`src/server/routers/teams.ts:45`) — `co_admin`-gated, no count limit.
  - `teams.delete` (`teams.ts:138`) — `co_admin`-gated; blocked once the competition has any
    score (`assertRosterUnlocked`, `teams.ts:150`).
  - `teams.update` (identity) — `teams.ts:98`.
  So **2–N is fully supported at the data layer.**
- **Where the "Add a team" affordance lives:** the Rosters surface —
  `RostersOverlay` → `TeamsPanel` (`src/components/competition/TeamsPanel.tsx`,
  `RostersOverlay.tsx`), opened from the board's "Rosters" button (`CompetitionFace.tsx:213`).

---

## 4. The `scoring_model` axis — what reads it

- **Server roll-up** `competitionLeaderboard.ts:46,67` reads `scoring_model`. It branches **only
  the non-golf MANUAL game award** (`:144` — `scoringModel === "match_play" && isManualType`).
  Golf is untouched (`062` comment, `competitionLeaderboard.ts:67`).
- **Non-golf result/config editors** branch on it:
  `NonGolfScoreboard.tsx:19`, `NonGolfConfigurationView.tsx:30`,
  `src/app/trips/[tripId]/games/manual/page.tsx:65`.
- **The leaderboard BOARD UI does NOT branch on `scoring_model`.** `TwoTeamHero` vs
  `NTeamRankedList` is selected by **`teams.length === 2`** (`CompetitionLeaderboard.tsx:244`).
  `scoring_model` is **not referenced anywhere** in `CompetitionLeaderboard.tsx`.
  **Divergence flagged** — spec hypothesised "leaderboard branches match_play→Ryder vs
  points→placement." It does **not**; the board shape keys on **team count**, not scoring model.
- **Is the `points`/placement path reachable in the UI? NO — latent.** Every competition is born
  `match_play` (DB default, no chooser). `scoring_model = 'points'` can only be set by a direct
  DB write — exercised only in tests (`competitions.matchplay.test.ts:85` does
  `update({ scoring_model: "points" })`). Migration `062:22-24` explicitly defers the chooser to
  W-TYPE-01. **`points` has never been exercisable through the UI.** The server compute
  (`competitionPlacement.ts` / `competitionLeaderboard.ts`) supports it; the gap is purely the
  missing creation chooser + the board UI keying on team count.

---

## 5. The game-type compatibility filter

- **Live filter `confirmed`.** `compatibleScoringModels` is declared at
  `gameTypes.ts:86` (spec ref correct) and set per format: stroke → `["points"]` (`:168`);
  singles/doubles/rack → `["match_play"]` (`:185`,`:202`,`:219`); the manual/generic types →
  `null` = any (`:236,253,270,287`).
- **The gate functions:** `isGameTypeForScoringModel` (`gameTypes.ts:346`) and
  `gameTypesForScoringModel` (`:358`).
- **Where it gates the picker:** **client-only**, in the add-game modal —
  `CompetitionGamesPanel.tsx:109` (`gameTypesForScoringModel(scoringModel, types)`), with
  `scoringModel` passed from `CompetitionFace.tsx:249` (`competition.scoring_model ?? "match_play"`).
- **No server guard.** `src/server/routers/games.ts` contains **no** `scoring_model` /
  `compatibleScoringModels` reference (grep-empty). The filter is presentation-only; the server
  does not reject an incompatible type. *(Mapping only — not a change request.)*

---

## 6. The live BBMI 2026 state (the coexistence question)

**Yes — a real, live competition already exists.** "BBMI Cup":

| field | value |
|-------|-------|
| `id` | `48488455-6286-4d07-aef3-e1936719c249` |
| `trip_id` | `c6cd4504-1eda-4772-aa8a-55f3474debc3` |
| `tagline` | "If you're not first you're last!" |
| **`status`** | **`active`** (already gone live) |
| `scoring_model` | `match_play` |
| `roster_setup` | `dismissed` |
| `defending_team_id` | `null` |

**Teams (2, both full):**
| name | short | color | color_dim | members |
|------|-------|-------|-----------|---------|
| **Rhinos** | RHI | `#ef4444` | `#2a0a0a` | 8 |
| **Phoenix** | PHO | `#a855f7` | `#1a0a2a` | 8 |

Note: **Rhinos still carries the exact seeded "Team B" defaults** (`#ef4444` / `#2a0a0a`,
`competitions.ts:229`) — i.e. it was created via the hardcoded seed and renamed/kept; Phoenix
was recolored to purple. This confirms the seed → rename lineage.

**Games:** **21 attached**, real and varied — singles, 2v2 doubles, rack-n-stack, stroke play,
generic-card — across `pending`/`active`/`complete`, with mixed `scoring_enabled`. So this is a
genuinely-used competition with scored data, not an empty stub.

(The other ~17 competition rows are all `test-*` fixtures + two throwaway "test" comps, every one
`match_play`.)

**Coexistence answer:** creation is **NOT always net-new.** A live, fully-populated BBMI Cup
exists, created the old (explicit) way and seeded with the hardcoded defaults. The new flow must
**coexist with / supersede** it — and the **one-competition-per-trip guard**
(`competitions.ts:190-202`, throws `CONFLICT` if a row exists) means the new flow **cannot
create a second**; it must edit-in-place or deliberately handle the existing row.

---

## 7. Where creation UI would mount

- **Trip-side button TODAY:** the "Set it up" card (`CompetitionEnableCard.tsx:86`) and the trip
  page `onEnableComp` (`page.tsx:447`) both **route to `/trips/${tripId}/leaderboard`** — they
  do **not** trigger creation. The card hides itself once a competition exists
  (`CompetitionEnableCard.tsx:39`, returns `null`), after which the bottom-nav "Live" entry is
  the way in (`page.tsx:555-559`).
- **The actual create form mounts** in `LiveFaceClient` on the no-competition + `canEdit` branch
  (`LiveFaceClient.tsx:182-190`): `CompetitionIntroPanel` → (unlock) → `CompetitionSetupPanel`.
- **So the new chooser flow replaces:** the `CompetitionIntroPanel` → `CompetitionSetupPanel`
  pair **plus the hardcoded 2-team / default-`match_play` seed in `competitions.create`**. The
  entry buttons themselves are clean routers — a good, stable mount point that needs no change.

---

## 8. The "GO LIVE / BACK TO SETUP" control — **LIVE and load-bearing, NOT a leftover**

- **Where rendered:** `CompetitionHeader.tsx` — `LiveToggleButton` (`:219-255`), placed in the
  header title row (`:145-150`). Labels: **"Go Live"** when `status === "upcoming"`,
  **"Back to Setup"** when `status === "active"` (`:251-252`).
- **What it does on click:** `onToggleLive` is supplied by `CompetitionFace`
  (`CompetitionFace.tsx:166-170`) → `toggleLive` (`:139-146`), which calls
  **`competitions.update` with `status` flipped `upcoming ↔ active`** (optimistic). The server
  mutation is `competitions.ts:252-293` (status enum `upcoming|active|completed`).
- **It flips a REAL, READ field** (`competitions.status`) — not write-only-dead. Downstream
  reads:
  - **Member visibility of the whole competition:** `canAccessCompetition({status})` gates the
    Live face — non-builders see `NotLiveEmptyState` until go-live
    (`LiveFaceClient.tsx:194-200`, `src/lib/competitionAccess.ts`).
  - **Bottom-nav "Live" entry / `showComp`:** `page.tsx:555-559`.
  - **Chrome-shrink + roster lock:** `CompetitionFace.tsx:74` (`isLive`), `:265`
    (`structureLocked={isLive}`); `CompetitionHeader` `compact`/badge.
- **Superseded by the per-game A2 toggle? No.** The per-game `games.scoring_enabled`
  (migration 057) arms one game; the competition-level `status` is the **crew-wide reveal /
  visibility switch** — a different axis. The control is genuine and current.
- **LANDMINE note (as requested, not changing it):** this is the live class — it flips a field
  multiple surfaces read to gate member visibility. **Reuse it; do not treat as inert / delete.**

**Divergence flagged:** spec wondered if it "does nothing anymore." Finding: it is fully wired
and load-bearing.

---

## 9. Competition settings + Danger Zone (makeover inventory)

- **Where settings live:** `CompetitionSettings.tsx`, reached from the header **gear**
  (`CompetitionFace.tsx:172,177-199`; gear button `CompetitionHeader.tsx:165`). It renders as a
  `view === "settings"` sub-surface over the board.
- **What's editable:** **name + tagline only** (`DetailsSection`,
  `CompetitionSettings.tsx:56-162`). **Not** editable here: `scoring_model` (no chooser exists
  anywhere), teams (moved to the Rosters overlay — comment `CompetitionSettings.tsx:27-31`),
  points (per-game).
- **Is there a competition-level Danger Zone? YES — it already exists** (contra the spec's "may
  be missing"). `DangerSection` (`CompetitionSettings.tsx:170-317`), a three-rung trip-pattern
  ladder using `DangerRow` / `DangerConfirmModal`:
  1. **Reset all scoring** → `competitions.resetScoring` (`competitions.ts:324`).
  2. **Reset all games to skeleton** → `competitions.resetToSkeleton` (`competitions.ts:346`).
  3. **Delete competition** → `competitions.delete` (`competitions.ts:299`).
  - **Gating:** the entire `DangerSection` renders **only when `isOwner && status === "upcoming"`**
    (`CompetitionSettings.tsx:47`). So **once the competition is `active`, no danger zone shows at
    all** — reset and delete both disappear post-go-live. *(A real gap for the makeover to weigh:
    the live BBMI Cup is `active`, so its owner currently has no reset/delete affordance.)*
- **Does anything lock settings once live/scored?**
  - Name/tagline: `canEdit`-gated, **not** status-locked (editable even when live).
  - Danger zone: hidden once `status !== "upcoming"` (above).
  - Roster mass-changes: locked once any score exists (`assertRosterUnlocked`, `teams.ts:150`,
    `src/server/lib/rosterLock.ts`).
  - There is **no competition-level `scoring_model` lock** — because there is no `scoring_model`
    editor to lock (the game-level scoring-mode lock is a separate, per-game concern).

---

## 10. Standalone readiness (flag only)

- **`competitions.trip_id` is `NOT NULL`** — verified in the migration
  (`...001_initial_schema.sql`: `trip_id text NOT NULL REFERENCES trips(id) ON DELETE CASCADE`)
  **and** in the live DB (`information_schema.columns` → `is_nullable = NO`). No later migration
  relaxes it.
- **Divergence flagged:** the spec/engine-doc framing ("`competitions.trip_id` nullable for
  standalone v2") does **not** match the shipped schema — for *competitions* the column is
  **NOT nullable**. (The doc's nullable note at `COMPETITION_ENGINE.md:317` is about *`games`*.)
- **Code assumes `trip_id` is always set**, broadly: every competition read keys on it
  (`competitions.getByTrip`, `faceBootstrap`), the viewer's competition role is **derived from
  trip role** (`faceBootstrap` `competitions.ts:84-89`), and RLS uses trip membership. So the
  standalone gap is **large** (the whole auth/role model is trip-coupled), not a one-line
  nullability change. **Flagging only — no design here.**

---

## Summary — what the new flow must REPLACE vs BUILD FRESH

**A live competition already exists → COEXIST / SUPERSEDE, not net-new.** "BBMI Cup" is
`active`, 2 full teams (Rhinos/Phoenix, 8 each), 21 scored games. The one-per-trip `CONFLICT`
guard (`competitions.ts:190-202`) means the new flow cannot just create a second row on that
trip — it must edit-in-place or explicitly handle the existing one.

**Replace:**
- The `CompetitionIntroPanel` → `CompetitionSetupPanel` create pair (`LiveFaceClient.tsx:182-190`).
- The hardcoded seed in `competitions.create` — the fixed 2 × (Team A/B, `#3b82f6`/`#ef4444`)
  teams (`competitions.ts:227-230`) and the implicit default-`match_play` (no `scoring_model`
  written).

**Build fresh:**
- A **shape chooser** that actually writes `scoring_model` (today nothing in the UI ever sets it)
  and a **team-count** choice (today hard-seeded at 2).
- The **points / placement leaderboard UI route** — server compute exists but is **unreachable**
  today because (a) no creation path produces `scoring_model = points` and (b) the board UI keys
  on `teams.length`, not `scoring_model` (`CompetitionLeaderboard.tsx:244`).

**Keep / reuse (already shipped, correct):**
- **GO LIVE / BACK TO SETUP** — live, load-bearing visibility switch (#8). Reuse, don't delete.
- **Competition Danger Zone** — exists (#9); the makeover mainly needs to reconsider its
  `upcoming`-only gating (no reset/delete once `active`).
- **`teams.create` / `teams.delete`** — 2–N ready at the data layer (#3).

---

*End of Phase 0. No code, migrations, or app-file changes were made; the only write is this
report. Live-DB access was read-only.*
