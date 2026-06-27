# W-GAMEPAGE-01 — Game-page lifecycle overhaul

**Status:** DESIGN COMPLETE. SHIPPED: phase (a) (#467) · Modifiers (#469). Remaining: (b) course-flow, (c) destructive guard *(A-only — PR #471 open; player-path orphan deferred to (d), issue #470)*, (d) surface-2 + back-stack + GameConfigurationView (→ W-BACKNAV-01).
**Scope of this file:** W-GAMEPAGE-01 only. The earlier WS4 reconciliation sections
(consolidation audit, engine decisions, betting/Circle) are a *separate* recovery pass
and are deliberately not rebuilt here.
**Origin:** Began as a styling pass on the game-configuration page; grew into a
re-architecture of the game page's whole lifecycle. Substantial parts are navigation-system
design (back-stack, surface transitions) surfaced through the game-page slice — carry those
into the nav session as **W-BACKNAV-01** input.
**Captured:** 2026-06 design sessions + Zach's mocks (redesigned shell, staged course flow,
Handicaps panel, Modifiers panel). Reviewed against the current shipped app (Images 2–7).

**Document authority:** This is a design-intent doc. Where it touches data shape, the
migrations remain authoritative (`games.modifiers` jsonb, `game_type_templates`). Where it
touches patterns, `CLAUDE.md` wins. If this doc conflicts with code, code is ground truth —
flag it, don't silently resolve.

---

## 1. Why this exists (what the current app gets wrong)

Three concrete failures in the shipped game-config page (Images 2–7), each fixed structurally
by the redesign rather than restyled:

1. **Read-only redundancy eats a full screen.** "Available Players" (Image 3) is a
   screen-height roster that, for a competition, is 100% derived from the teams — the team
   list restated, nothing editable, captioned "Manage assignments from the team cards." It
   carries zero decisions.
2. **No hierarchy.** Six identical-weight rows with "· optional" as a grey whisper. Nothing
   signals that Matches / Points / Course are the spine that gates *Enable scoring* while
   Handicaps / Modifiers / Instructions are extras. This is the "hard to tell what task
   you're on" complaint — a grouping problem, not a labeling one.
3. **Dead controls render anyway.** Handicaps (Image 6) shows the full −/+ stepper and an
   "Even match — no strokes given" caption on *every* match even when all are Even.
   Empty match slots get the same height as filled ones. Controls should be live when shown
   and summarized when not.

Principle running through the fix: **show the control when it's live; summarize when it's not;
don't render a dead affordance at all.**

---

## 2. The two-surface model

The game page is two faces of one route plus one detour surface.

| Surface | Reachable when | Entered from | Renders | Who |
|---|---|---|---|---|
| Game page — **setup face** | game in **setup** mode | leaderboard | editable settings (the config rows) | owner / delegate only |
| Game page — **scoring face** | game in **scoring** mode | leaderboard | the scoreboard (live game) | everyone |
| **Settings summary** (surface 2) | **scoring** mode only | the scoreboard (tap in) | read-only settings summary + danger zone + "switch to setup" | owner / delegate |

- In setup mode, the settings **are** the page.
- In scoring mode, the settings become a **separate read-only summary** reached from the
  scoreboard — a different surface for a different moment (building vs. adjusting a live game).
- **Reset to Defaults** (light skeleton-reset) lives on the setup face.
- The full **danger zone** (already built: Phase A reset primitives + `GameDangerZone` #457)
  lives on surface 2. The two never coexist — different surfaces.

---

## 3. The Setup/Scoring toggle

A **non-destructive access-and-edit gate**, *not* a scoring on/off switch. (This is a tweak on
the existing enable/disable-scoring concept, reframed.)

- **Setup:** members can't open the game (not clickable for them); owner/delegate edits freely.
- **Scoring:** members can open + play; settings **lock** (read-only summary on surface 2).
- Flipping is **pause-mode** — scores are untouched in either direction.
- **Settings lock during scoring is deliberate friction.** To edit a live game you flip back to
  Setup. Changing a live game should feel deliberate, and it models real golf (format locks at
  tee-off).
- Each flip is **gated by a directional confirm** that explains that direction's consequence
  (member access changes; scores are safe).

---

## 4. Back-stack (W-BACKNAV-01 input — these are nav rules)

- **Mode transitions (Setup ↔ Scoring) REPLACE the stack, never push.** You always land with the
  leaderboard behind you; stale prior-mode surfaces are cleared.
  - Scoring→Setup: `leaderboard → scoreboard → settings-summary` ⇒ REPLACE ⇒
    `leaderboard → game-page(setup)` → back = leaderboard. (Resolves the broken back-button.)
  - Setup→Scoring: `leaderboard → game-page(setup)` ⇒ REPLACE ⇒
    `leaderboard → scoreboard` → back = leaderboard.
- **Tapping into the settings-summary from the scoreboard PUSHES** (it's a detour) → back returns
  to the scoreboard.
- **Back from any game page → leaderboard.**
- ⚠ **Edge:** a deep-link into a game (notification / chat) may need to synthesize a leaderboard
  entry so "back" always has somewhere to land.

---

## 5. Page structure (setup face)

Three organizational zones over a single scrolling mobile column. **The zones are labels, not
panes** — there is no side-by-side layout; it's still one column. This matters for accordion
behavior (§9).

### Zone 1 — Identity header
- Game name, tap-to-edit inline (pencil affordance).
- "Assigned to {delegate}" frame with × to clear the delegate.

### Zone 2 — Game Management
Pure game-lifecycle controls, **zero config**:
- Setup/Scoring toggle (§3)
- Reset to Defaults (§2)
- Delegate / assigned-to frame

> **⚠ Build reality (Phase 0, W-GAMEPAGE-01a):** the toggle + Reset currently live on
> `GameConfigurationView` (the *post-enable* edit surface) and `GameDangerZone`, **not** on the
> pre-enable `match/new` setup screen. So **Zone 2 is empty pre-enable and populates only in phase
> (d)**, when the two-surface model (§2/§4) moves those controls onto the setup face. Phase (a)
> groups the setup screen into **Zone 1 / Zone 3 / Zone 4 only** — no empty Zone 2 shell.

> **Two config surfaces (Phase 0 finding):** there are two setup surfaces — the `match/new` setup
> screen *and* `GameConfigurationView` (post-enable edit). The §2 two-surface model must rationalize
> `GameConfigurationView` in phase (d); see §14(d). Phase (a) touches `match/new` only.

> **Competition note:** for a competition there is **no player readout** on the setup face. Players
> are fully derived from the teams (e.g. Rhinos vs Phoenix), so there's no player-context to
> disclose. See §8 — the "16 Players · …" readout is a **standalone-only** affordance
> (W-STANDALONE-01), never part of the competition surface.

### Zone 3 — Settings (the required spine)
The three rows that gate *Enable scoring*:
- **Matches** (§6.1)
- **Points** (§6.2)
- **Course / Tee** (§6.3)

### Zone 4 — Options (optional, tagged "· optional")
- **Handicaps** (§6.4)
- **Modifiers** (§6.5) — *hidden entirely when the format supports none*
- **Rules of the Day** — plain textarea ("formats, gimmes, mulligans, tiebreakers…")

### Exit actions
- **Enable scoring** — readiness-gated (see §7).
- **Save & exit** — always enabled; flushes the Rules textarea (the textarea has no collapse
  event, so it's genuinely unsaved until exit — "Save" is honest here).

---

## 6. The config rows

Each row is a collapsed summary (LABEL + value + green check when resolved) that expands to an
in-place accordion editor. Editors persist-on-collapse with optimistic acknowledgment (onMutate
shows the check/value instantly, background save, rollback on failure).

### 6.1 Matches
- **Count is derived, never set.** No "number of matches" field. **The pre-create count stepper
  ("Matches to add") is removed** (Phase 0 found it still present; W-GAMEPAGE-01a removes it).
- **Start at ONE empty match** (not zero, not N). Gives an obvious first action without presuming
  the count.
- Per match: `MATCH N` header, remove (−), drag handle (⋮⋮), two player slots with "vs",
  "+ Add player" for empty slots. Tap a slot to pick; drag to reorder. (All already shipped.)
- "+ Add match" appends another empty row at the bottom.
- **Any match with an empty player slot is invalid** (red-X). Not just the trailing match — a middle
  match with one filled and one empty slot is equally invalid. This *is* the readiness rule:
  Enable-scoring gates on **zero unfilled matches** (§7). No separate validity check.
- **Fill-or-remove, not auto-drop.** This model **supersedes #460's collapse-on-incomplete** (which
  dropped unfilled matches and teed off with fewer on a confirm). Build-as-you-go means matches are
  never pre-seeded as empties, so an empty match is an *unfinished add*, not a deliberate blank —
  the resolution is to fill it or remove it, enforced by the gate. (Removed in W-GAMEPAGE-01a as an
  audit-before-delete on `CollapseConfirm`/`confirmCollapse`.)
- Workflow rationale: pairings are built one matchup at a time (set match 1, then match 2, …),
  *not* by assigning players to arbitrary match numbers. Pre-filling N empty matches presumes a
  count that isn't universal (BBMI is always 8; other competitions vary).

### 6.2 Points
- **Competition Format:** a "How's it played?" picker. Sets the **label on the leaderboard.**
  Running the format in-app comes later — until then results are entered by hand. (Copy must
  carry this; don't imply auto-scoring.)
- **Points per match:** −/+ stepper, **required** (red dot).
- **Points follows Matches:** surface **Total Points Available = match count × per-match** so the
  stakes are visible (the current app shows per-match only).

### 6.3 Course / Tee
- Resolved state: course + tee shown, "× Change course" button (Image 5).
- Selection runs the **staged search flow** (§10).
- Gates Handicaps (§6.4) — handicaps require a complete 18 with a stroke-index table.

### 6.4 Handicaps  *(optional)*
- Per match: `MATCH N · WHO GETS STROKES?` with a **three-segment selector**:
  `{Player A} | Even | {Player B}`.
- **Even → collapse to one row**, caption "Even match — no strokes given." **No stepper rendered.**
- **A side picked → reveal the −/+ STROKES stepper** and the allocation caption
  ("on holes 1, 2, 3" / "on holes 2, 4, 6, 13").
- Each match inlines its own matchup (restates "Jeremy vs Ty"), so Handicaps is
  self-referencing — you don't need Matches open alongside it (relevant to §9).
- **Hard-gated on BOTH Matches AND Course** (a complete 18). Handicaps without a stroke-index
  table isn't a valid configured state.

> **✓ Closed (#466 merged) — indexed-nine compose verified.** The "N strokes on holes
> a, b, c" allocation consumes the **stroke-index table** from the composed course. The indexed-nine
> compose (two real indexed 9-hole courses → interleaved 18 → correct handicap allocation — the real
> September/BBMI path) is now **verified on real indexed data** through the actual
> `applyCourse → setBackNine` path (#466): correct interleaved 1–18, allocation spread across both
> nines, and swap-preserves-front-index. The verification **caught and fixed a shipped swap-path
> bug** (#465's swap read the already-composed 18's interleaved front index, length 18 not 1–9, so
> `composeTwoNines` silently dropped the index → index-off allocation on every back-nine swap; the
> #465 eye-check missed it because its course had no index to lose). `games.9hole.test.ts` locks the
> regression. Handicaps hole-allocation is safe for the BBMI 3×9.

### 6.5 Modifiers  *(optional — hidden when none apply)*

> **✓ RECONCILED to as-built (#469 merged).** Phase 0 corrected three specifics this section
> originally got wrong against the codebase — keys, applicability source, and jsonb shape (the
> strikethroughs below). The design intent (config-only, hide-when-none, copy guardrail) shipped
> intact.

- **Applicability is code-driven** (~~read `compatible_modifiers` from the DB~~). The applicable set
  comes from `gameTypes.ts` `compatibleModifiers` — format-definition data fixed by the code that
  implements each format, never per-game/per-trip. W-PERF-01 moved format defs into code because
  DB-fetching them blanked the add-game dialog for 20–30s on bad signal; reading modifiers
  applicability from the DB would reintroduce that. The `game_type_templates.compatible_modifiers`
  column is **deprecated** — not read, not written.
- **What lives in code is a modifier registry** (`src/lib/modifiers.ts`):
  `key → { label, description, controlType }` + pure presence-model read/write helpers. Code answers
  *which modifiers apply* (via `gameTypes.ts`) **and** *how each renders and stores*.
- **Panel logic** (`ModifierCards.tsx`, shared by the `match/new` setup row + `GameConfigurationView`):
  read the format's `compatibleModifiers` → look each key up in the registry → render those cards.
  **List empty → hide the entire Modifiers row.** Consequence: the Options group has variable
  membership; accepted.
- **Config-only scope.** A toggled modifier writes to `games.modifiers` jsonb and does **nothing** to
  scoring behavior. Execution engines stay deferred (`DEFERRED.md`). Not a broken promise: in the
  hand-entered era a toggled modifier is a **structured rule-of-the-day** — recorded, not computed.
- **Copy guardrail:** the on-state must **not** imply auto-enforcement. Moving Tees especially looks
  like it should change the scorecard. "Recorded, not yet auto-scored" carries in the shipped copy.
  (Final voice pending Zach.)

**Modifier definitions (as built — snake_case keys, presence-model jsonb):**
Presence of a key in `games.modifiers` = enabled; absence = disabled (~~`{ enabled: bool }`~~).
The reader is legacy-tolerant: a production `glorious_holes: {}` (no `holes`) reads as the default 3.

| Key | Control | jsonb value (when present) | Notes |
|---|---|---|---|
| `glorious_holes` | checkbox + **hole-count** stepper | `{ holes: N }` | Stepper = **number of trailing holes** worth double. Doubling is **fixed/implied**, not a multiplier. **Default `holes: 3`.** |
| `moving_tees` | checkbox | `{}` | No parameter. |

---

## 7. Readiness gate (Enable scoring)

`Enable scoring` is enabled when the **required spine** is satisfied:
- **Matches:** zero unfilled matches — **any** match with an empty player slot blocks (not only the
  trailing one — §6.1). This is a hard block that **replaces** #460's collapse-on-incomplete
  auto-drop. The validity signal (`allFilled`) already exists today (it outlines the button); the
  flip is making the button actually `disabled` when `!allFilled`.
- **Points:** points-per-match set (required, red dot — §6.2).
- **Course:** selected (a complete 18 — §6.3).

Options (Handicaps, Modifiers, Rules) **never** gate. `Save & exit` is always enabled.

---

## 8. Standalone seam (W-STANDALONE-01)

"Available Players" is removed from the **competition** surface entirely — it's team-derived and
duplicated. The "16 Players · {teams}" readout and any direct player add/manage UI belong only to
the **standalone-game** world, where players are *not* team-derived and genuinely need to be
seen/managed. Framing: not "hidden for competitions" but "a standalone-only affordance that was
never part of the competition surface." When standalone games are built, reintroduce a player
panel conditionally there.

---

## 9. Accordion behavior

- **One open panel at a time, GLOBAL across all zones.** No per-section scoping.
- Rationale: the zones aren't spatial (§5) — it's still one scrolling mobile column, so the
  original reason for single-open (two tall panels open = scroll swamp + lose your place) is
  fully intact. Per-section scoping would let, e.g., Course and Handicaps both be open, buying
  only cross-referencing — which Handicaps already solves by inlining its own matchups (§6.4) —
  at the cost of "some rows close each other, some don't" inconsistency and split-state
  complexity.
- **No carve-out.** With the player readout gone for competitions (§8), the single-open slot is
  unconditionally the five config rows (Matches, Points, Course, Handicaps, Modifiers — Modifiers
  only when present). Reset and the Setup/Scoring toggle are not accordion rows.
- **Flips this decision only if** a workflow genuinely needs a Setting and an Option open together.
  None identified.

---

## 10. Staged course-search flow

1. **Default:** recents + a search bar.
2. **On type:** switch to local / BBMI courses, **live-filter** (no API call yet).
3. **On enter:** **fire the API call.** Adds a `SEARCH RESULTS` section (deduped against local) —
   and **only now** surface the "+ Add course manually" button (not before).
4. **18-hole pick:** choose tee → Confirm 18-Hole Round.
5. **9-hole pick:** Confirm 9-Hole Round **or** "+ Add Back 9" — the #465 W-9HOLE inline flow,
   presented inline (not a separate screen).

---

## 11. Destructive-edit guard (point-of-action, not global)

- Removing a player or match **that has scores** → warn + confirm
  ("Match N has scores — removing clears them").
- Fires **only** on removal-of-a-scored-unit. Everything else re-derives safely
  (derive-don't-snapshot).
- Partly already enforced: `applyCourse` freezes on scores.

---

## 12. Reuse (don't rebuild)

- `GameDangerZone` (#457) — danger zone on surface 2.
- Reset primitives (Phase A, migration 066) — Reset to Defaults on the setup face.
- Resolved-state display (#462) — collapsed-row summaries.
- W-9HOLE flow (#465) — the 9-hole / back-9 inline step in the course flow.
- The `<Sheet>` primitive — if surface 2 lands as a sheet (see OPEN pins).

---

## 13. OPEN pins (settle at spec/build time)

These are deliberately unresolved. Several cross PR boundaries (§14).

1. **Surface 2 — full page vs `<Sheet>` overlay.** Lean `<Sheet>` (nav-consistent,
   recede-and-return) — but then "switch to setup" = dismiss-sheet + mode-transition-replace on
   the page underneath (a sheet with a nav side-effect). Full page is simpler for the stack.
   Settle with the nav-consistency lens (W-BACKNAV-01).
2. **Scoring→Setup re-render — clean in-place navigate vs reload.** Reload is a UX smell; prefer a
   clean navigate if state remaps cleanly. Phase 0 / build call.
3. **Back-nine tee — inherit the front's tee vs pick its own.** Lean inherit.
4. **Add-manually timing — confirm that API-returns-nothing surfaces the manual button cleanly**
   (it should appear with SEARCH RESULTS on enter, even when results are empty).

---

## 14. Spec phasing (this is big — DO NOT spec as one PR)

Likely split (updated post-W-GAMEPAGE-01a Phase 0):

- **(a) Structural core** — ✅ SHIPPED (#467: T1 zones · T2 hard-block + count-stepper/CollapseConfirm removed · T3 Total Points · T4 hide roster · T5 `matchDraft.ts` + tests). *Scope as built:* Zone grouping (Zone 1/3/4 only on `match/new`; **no
  Zone 2** until d) + Matches hard-block model (remove pre-create count stepper, remove #460
  collapse-on-incomplete, gate on any-empty-slot) + Total Points readout (pipe derived count into the
  Points panel) + hide Available Players for competitions. The accordion (§9) and identity header
  (§5 Zone 1) are **already shipped** (#462/#463) — confirm, don't build. **The toggle/lock moved
  OUT of (a) → (d)** (the toggle isn't on the setup screen pre-enable).
- **(b) Course-flow refinement** — staged search (§10) is ~shipped (#464); remnant is mostly OPEN pin
  #4. Likely a punch-list, not a full phase.
- **(c) Destructive-edit guard** (§11) — small, contained.
- **(d) Surface-2 + back-stack nav + toggle/lock** (§2 surface 2, §3 toggle lock + directional
  confirms, §4) — nav-adjacent; reuse `<Sheet>`; keep consistent with W-BACKNAV-01. **Also absorbs
  `GameConfigurationView`** (the post-enable edit surface found in Phase 0) into the two-surface
  model — reconcile it against setup-face / scoring-face / settings-summary rather than leaving two
  divergent config surfaces. Carries OPEN pins #1, #2.
- **Modifiers** (§6.5) — ✅ SHIPPED (#469): shared `lib/modifiers.ts` + `ModifierCards.tsx`, data-driven from `gameTypes.ts`, config-only, no engine. Phase 0 reversed the DB-applicability + camelCase + `{enabled,holes}` assumptions (see §6.5 reconcile note).

Each PR follows the standard CC contract: Phase 0 diagnose-first report-and-STOP, DO-NOT lists,
per-task commits, `tsc --noEmit` + `next lint` clean, verify-by-eye on real data, audit-before-delete.

---

## 15. Standing decisions ledger (this pass)

| Decision | Resolution |
|---|---|
| Available Players (competitions) | Removed; team-derived. Standalone-only affordance (W-STANDALONE-01). Branch already exists; phase (a) stops rendering the competition branch. |
| Game Management (competition) | Toggle + Reset + delegate. **Toggle/Reset live post-enable, not on setup screen → Zone 2 empty in (a), populates in (d).** |
| Matches count | Derived, not set. Pre-create count stepper removed (W-GAMEPAGE-01a). |
| Matches initial state | One empty row. |
| Matches validity | **Any** match with an empty slot = invalid (not just trailing); hard-blocks Enable scoring. **Replaces #460 collapse-on-incomplete.** |
| Points | Follows Matches; surface Total = valid-matches × per-match (count piped into Points panel). |
| Competition Format | Sets leaderboard label only; in-app run deferred; hand-entry until then. |
| Modifiers applicability | **As built (#469):** code-driven from `gameTypes.ts` `compatibleModifiers` (NOT the deprecated DB `compatible_modifiers`). |
| Modifiers render/store | Shared `lib/modifiers.ts` registry `key → {label, description, controlType}` + presence-model helpers; `ModifierCards.tsx` UI. |
| Modifiers empty | Hide the entire row. |
| Modifiers scope | Config-only → `games.modifiers` jsonb; engine deferred. |
| Glorious Finishing Holes | **As built:** key `glorious_holes`; hole-**count** stepper, doubling implied; value `{ holes: N }` (presence = enabled); default `holes: 3`; legacy `{}` → 3. |
| Moving Tees | `{enabled}`; no parameter. |
| Accordion | Single open, global; no carve-out. |
| Handicaps gate | Hard-gated on Matches AND Course (complete 18). |
| Handicaps trust | **Closed (#466 merged)** — verified on real indexed data: interleaved 1–18, allocation across both nines, swap-preserves-front. Compose caught + fixed a shipped swap-path index-drop bug. Safe for BBMI 3×9. |

---

## Cross-references
- `CLAUDE.md` — enforced patterns (optimistic updates, migration naming, RLS split, middleware auth).
- `STYLE_GUIDE.md` — `--color-bt-*` tokens; all surfaces/colors via tokens.
- `PERMISSIONS.md` — owner/planner/member gating; competition setup is `canEdit`.
- `DEFERRED.md` — modifier execution engines (moving tees, carry-style scoring) remain deferred.
- Migrations — authoritative for `games.modifiers`, `game_type_templates`.
- W-BACKNAV-01 (future nav session) — consumes §4 back-stack rules and OPEN pins #1–#2.
- W-STANDALONE-01 (future) — reintroduces a player panel for standalone games (§8).
