# CC SPEC — W-GAMEPAGE-01 Phase (a): Structural Core

**Model:** Opus (multi-file, structural).
**Branch:** one feature branch, merged before the next phase.
**This is phase (a) of a multi-PR feature. Do NOT attempt the whole of W-GAMEPAGE-01.**

---

## 0. Read first (authority order)

1. `W-GAMEPAGE-01_game_page_lifecycle.md` — the design. This spec implements a **subset** of it.
2. `CLAUDE.md` — enforced patterns (optimistic updates, migration naming, RLS split, middleware
   auth, what "done" means).
3. `STYLE_GUIDE.md` — every color/surface via `--color-bt-*` tokens. No hex.
4. `PERMISSIONS.md` — competition setup is `canEdit` (owner/planner).

**Ground rules (from CLAUDE.md, restated because they bind every task):**
- Code is ground truth. If this spec disagrees with the code, **STOP and flag** — do not silently
  resolve.
- Commit after each task, not at phase end. Clear messages.
- `npx tsc --noEmit` AND `next lint` must pass after every commit (tsc-clean ≠ build-clean).
- Audit before delete — sacred. Never remove a component/export without enumerating its references.
- Derive, don't snapshot. Fail loud, not silent.
- Verify the path you didn't test — eye-verify on real data, not just unit green.

---

## 1. Scope

### In scope (phase a) — four contained, nav-decoupled items
- **T1 — Zone grouping (§5).** Re-parent the existing setup-face rows into three labeled zones:
  Game Management / Settings / Options. **Presentational only** — confirmed no data-model or route
  change underneath.
- **T2 — Matches reconcile (§6.1).** Bring Matches to: derived count (no count setting), start at
  one empty match, trailing/unfilled match = invalid, and that invalidity feeds the Enable-scoring
  gate.
- **T3 — Total Points Available (§6.2).** Surface `matches × per-match` as a readout. Points
  follows Matches.
- **T4 — Available Players gating (§8).** Hide the team-roster readout panel for **competitions**
  (it's team-derived redundancy). Extract-and-gate, **not delete** — it survives for standalone
  games (W-STANDALONE-01).

### Explicitly OUT of scope — do NOT build in this PR
- ❌ The two-surface model, surface-2 settings-summary, and back-stack REPLACE rules (§2/§4) → **phase (d) / W-BACKNAV-01.**
- ❌ Setup/Scoring toggle **lock behavior** + **directional confirms** (§3) → **phase (d).** The
  existing toggle stays exactly as-is in this PR. Do not add confirms, do not add settings-lock,
  do not change its current behavior.
- ❌ Staged course-search refinement (§10) → already ~shipped (#464); remnant is phase (b).
- ❌ Handicaps three-segment / collapse-when-Even / reveal-stepper (§6.4) → later phase.
- ❌ Modifiers data-driven panel (§6.5) → separate small spec.
- ❌ Destructive-edit guard (§11) → phase (c).
- ❌ Anything touching `games.modifiers` jsonb, `game_type_templates`, or migrations.

If a task seems to require an out-of-scope item to work, **STOP and report** — don't pull it in.

---

## 2. Phase 0 — Diagnose & Report, then STOP

**Produce a report. Change no code. Wait for go.** Phase 0 has caught a wrong assumption on nearly
every prior spec. Here the specific risk is staleness: the design-review notes predate the most recent
Matches redesign, so treat any "what currently exists" claim in this spec as *to be confirmed against
the code*, not as fact. Report the real current state and let it resize the tasks.

Report the following:

**Map**
1. The setup-face component tree for a per-game config page: file path(s), the row components, how
   rows are currently parented/ordered, and where the accordion single-open state lives (expected:
   shipped in #462 — confirm).
2. How a game is identified as a **competition** vs **standalone** in this code (the discriminator
   field/prop). T4 depends on this.
3. The Enable-scoring readiness check: where it lives, what it currently gates on.

**Matches (report current post-redesign state — this is the main unknown)**
4. The **current** Matches row implementation after the recent manual-match redesign. Expected (to
   confirm): manual match building — add/remove/drag rows with player slots and "+ Add match" — and
   **no count stepper** (an older audit referenced a count stepper, but that predates this redesign;
   confirm it's gone). Give file + line refs and what data backs the match list.
5. Does **drag-to-reorder** exist on matches? Does **per-match remove** exist? Does **"+ Add match"**
   exist? (Expected: yes to all post-redesign. Confirm.)
6. Fresh-game initial state when Matches first opens — zero rows, one row, or N?
6a. **The genuine gap to find:** does **"unfilled match = invalid → blocks Enable-scoring"** already
    exist, or not? Report the match-validity state (if any) and whether the readiness gate already
    reads it. This single answer determines whether Task 2 is real work or already done.

**Points**
7. Current Points row: format-picker + per-match stepper confirmed shipped (#463)? Is there any
   total-points display today? Where would `matches × per-match` read the match count from (must be
   the same derived source as the Matches row — one canonical home, no second count)?

**Available Players**
8. The team-roster readout panel component name (the audit calls it `TeamsPanel`, added in #462).
   **Enumerate every reference/mount site.** Is it mounted only on this setup surface, or elsewhere?
   This determines whether T4 is a clean conditional-render or needs extract-to-preserve.

**Flag**
9. Any place where the current code already diverges from §5/§6.1/§6.2/§8 in a way that makes a task
   smaller or larger than this spec assumes.

End the report with a per-task **revised size estimate** (shrunk / as-specced / grew) and **STOP.**

---

## 2.5 — Phase 0 RESOLVED (findings + decisions; build from this, not the "expected" framing above)

Phase 0 ran and the current state diverged from the spec's assumptions in two ways. Both were
escalated and **decided**. The "expected" language above is superseded by these facts:

**Findings (real current state):**
- The competition setup face is the `match/new` page's `screen === "setup"` block
  (`src/app/trips/[tripId]/games/match/new/page.tsx` ~952+). There are **two** config surfaces: this
  `match/new` setup screen **and** `GameConfigurationView` (the *post-enable* edit surface). **Phase
  (a) touches `match/new` only.** `GameConfigurationView`'s regroup is deferred to phase (d), where
  the two-surface model (§2/§4) rationalizes it.
- A **pre-create count stepper DOES exist** ("Matches to add" on the `NewGame` screen; `matchCount`
  state, default 1; `handleCreate` seeds the draft with `matchCount` empty matches). The "confirm
  it's gone" assumption in §2.4 was **wrong** — it's there.
- **Collapse-on-incomplete (#460) is the current behavior, not a hard block.** An unfilled match
  triggers `CollapseConfirm` (`confirmCollapse` state) → drop the unfilled match and tee off with the
  filled ones. Enable-scoring is enabled with **≥1 fully-filled match** (`disabled` gates on
  `filledDraft.length === 0`; `outlined={!allFilled}` already exists).
- The Zone-2 controls (Setup/Scoring toggle, Reset) live on `GameConfigurationView` / `GameDangerZone`
  (post-enable) — **not** on the `match/new` setup screen. Pre-enable, Zone 2 has nothing to hold.
- `TeamsPanel` has 5 refs, **2 real renders**: `RostersOverlay` (leaderboard rosters — different
  surface) and `match/new:1014` (the only setup-surface mount). The competition/standalone branch
  **already exists** at the Available-players row.
- `FormatPointsPanel` (#463) is a `GameSetupRows` child and **cannot see the match draft** — it has
  `perMatchValue`/`total` but no match count. The canonical count lives in the page's
  `draft`/`filledDraft`.

**DECISION A (FLAG A — confirmed):** Phase (a) groups the `match/new` setup face into **Zone 1
(Identity) / Zone 3 (Settings) / Zone 4 (Options)** only. **Zone 2 is N/A in phase (a)** — it
populates in phase (d) when the toggle/reset move onto the setup face. T1 below is rewritten to this.

**DECISION B (FLAG B — confirmed):** T2 **replaces** collapse-on-incomplete with a hard
**no-unfilled-matches block**, and **removes the pre-create count stepper**. Rationale: build-as-you-go
means matches are no longer pre-seeded as empties, so there is no "incomplete set" to collapse — an
empty match only exists mid-add, and the model is fill-it-or-remove-it. The two behaviors are one
coupled philosophy; they move together. T2 below is rewritten to this and treats the #460 removal as
an explicit audit-before-delete.

---

## 3. Task 1 — Zone grouping (§5)

**Goal:** the `match/new` setup face reads as labeled groups instead of flat equal-weight rows.
**Target the `match/new` setup screen only.** `GameConfigurationView` (post-enable) is NOT regrouped
here — that rides phase (d).

- **Zone 1 — Identity header:** game name (tap-to-edit) + assigned-to/delegate frame. **Already
  shipped (#463). Do not rebuild** — just ensure it sits above the zones.
- **Zone 2 — Game Management: N/A in phase (a).** The Setup/Scoring toggle + Reset live on
  `GameConfigurationView`/`GameDangerZone` (post-enable), not on this setup screen. There is nothing
  to put in Zone 2 pre-enable. **Do not create an empty Zone 2; do not move the toggle/reset here**
  (that's phase d). Skip straight from Zone 1 to Zone 3.
- **Zone 3 — Settings:** Matches, Course/Tee, Format·Points — in that order (matches the current
  surface order; the spine).
- **Zone 4 — Options:** Handicaps, Modifiers, Rules-of-the-Day textarea. Optional rows keep their
  "· optional" tag.

**Rules**
- Presentational re-parent + zone headers only. No change to row internals, data, routes, or the
  accordion's single-open behavior (which stays **global across all zones** — §9).
- Zone headers and surfaces use `--color-bt-*` tokens (STYLE_GUIDE §1/§2). No hex, no
  Tailwind color utilities on themeable surfaces.
- The single-open accordion slot is the **five config rows** (Matches, Points, Course, Handicaps,
  Modifiers-when-present). Reset and the toggle are not accordion rows and don't participate.

**DO-NOT:** don't introduce per-section accordion scoping; don't make zones into side-by-side panes
(it's one scrolling column); don't restyle row internals.

**Commit:** `feat(game-setup): group config rows into Game Management / Settings / Options zones`
→ tsc + lint clean → eye-verify the three zones render with correct row membership and the
accordion still closes cross-zone.

---

## 4. Task 2 — Matches: hard-block model + remove collapse-on-incomplete (§6.1)

**Goal:** every match in the list is real; an empty match is an unfinished add, and you must
**fill it or remove it** before Enable-scoring. This **replaces** the shipped collapse-on-incomplete
behavior (#460) and **removes** the pre-create count stepper. (See §2.5 DECISION B.)

Build-as-you-go already ships (manual rows, per-match remove, drag-reorder, "+ Add match" — leave all
as-is). The net work is the gate flip plus two audit-before-delete removals.

**Three pieces:**

1. **Remove the pre-create count stepper.** On the `NewGame` screen, remove the "Matches to add"
   stepper UI and the `matchCount` state. `handleCreate` seeds the draft with **exactly one** empty
   match (start-at-one). Audit every reader of `matchCount` before removing it (fail loud if anything
   else depends on it).

2. **Flip the gate to a hard block (any empty slot = invalid).**
   - The validity signal already exists: `allFilled` is computed today (it drives `outlined={!allFilled}`).
     The flip is making the button **actually `disabled` when `!allFilled`**, not merely outlined.
   - **Invalid = any match with one or more empty player slots** — not only the trailing match. A
     middle match with one player and one empty slot also blocks. ("Trailing empty" in the design doc
     was the common-case description, not the rule.)
   - Gate reads the **derived match validity**, never a count field.
   - Invalid-state styling via tokens (`--color-bt-danger` family, STYLE_GUIDE §2/§3).

3. **Remove collapse-on-incomplete (#460) — audit-before-delete.** With the hard block, the
   `confirmCollapse` flow and `CollapseConfirm` component are dead on this path. Before deleting:
   **enumerate all references to `CollapseConfirm` and `confirmCollapse`.** If `CollapseConfirm` is
   mounted only here, remove the component + its state + its trigger. If it's reused elsewhere, remove
   only this path's usage and leave the component. Report what you found before deleting.

**Rules**
- One canonical home for the match list + derived count (the page `draft`/`filledDraft`). Points (T3)
  and the gate both read from it. No second source of truth for the count.
- Optimistic updates pattern (CLAUDE.md #1) for add/remove/edit if not already in place.

**DO-NOT:** don't keep the count stepper "just in case"; don't leave `CollapseConfirm` wired on this
path; don't let the gate read a count instead of validity; don't pre-seed empty matches.

**Commit:** `feat(game-setup): hard-block scoring on unfilled matches; remove pre-create count + collapse-on-incomplete`
→ tsc + lint clean → eye-verify: fresh game shows exactly one empty match; an empty slot (trailing OR
middle) blocks Enable-scoring and shows invalid; removing or filling it clears the block; no
collapse-confirm appears on enable.

---

## 5. Task 3 — Total Points Available (§6.2)

**Goal:** stakes are visible — show `Total Points Available = valid match count × per-match`, for
**match-format games only**.

- **The piping is the work.** Phase 0 confirmed `FormatPointsPanel` (#463) is a `GameSetupRows` child
  and **cannot see the match draft** today. Pass the derived count from the page's canonical source
  (`draft`/`filledDraft`) into the panel — don't compute a second count inside it.
- Use the **valid (fully-filled) match count**, so an in-progress empty slot doesn't inflate the total
  with phantom points.
- Recompute on every change to either the match count or per-match (derive, don't snapshot).
- Display where the design shows "Total Points Available: N" (collapsed summary may still show
  per-match).
- Format-picker + per-match stepper already shipped (#463) — don't rebuild; just add the derived total.
- Match-format games only (this is a match-play points readout).

**DO-NOT:** don't store the total; don't add a second match-count source inside the Points panel.

**Commit:** `feat(game-setup): surface Total Points Available (matches × per-match)`
→ tsc + lint clean → eye-verify: total updates live when matches or per-match change.

---

## 6. Task 4 — Available Players gating (§8)

**Goal:** the team-roster readout panel does not render for **competitions** (team-derived
redundancy), but is **preserved** for standalone games.

**Phase 0 confirmed this is the smallest task:** the competition/standalone branch **already exists**
at the Available-players row (`match/new:~1014`), and `TeamsPanel` has only two real renders —
`RostersOverlay` (a different surface) and that one setup-surface mount. So this is a one-row change.

- **Stop rendering the competition (`TeamsPanel`) branch** at the Available-players row; keep the
  standalone (flat crew list) branch exactly as-is.
- **Leave `TeamsPanel` and `RostersOverlay` completely untouched** — `TeamsPanel` survives for the
  standalone world (W-STANDALONE-01) and `RostersOverlay` is an unrelated leaderboard surface.
- **Do NOT hard-delete `TeamsPanel`, its file, or its export.** Removing it now is the exact mistake
  the audit-before-delete rule exists to prevent.
- For a competition, the setup face shows **no player readout at all** — not a collapsed stub. (Note:
  per DECISION A there is no Zone 2 on this screen; the readout simply doesn't render.)

**DO-NOT:** don't delete `TeamsPanel`/its file; don't touch `RostersOverlay`; don't remove
team-derivation logic; don't change the standalone path's behavior.

**Commit:** `feat(game-setup): hide team-roster readout for competitions (keep for standalone)`
→ tsc + lint clean → eye-verify: a competition game shows no player readout on the setup face; a
standalone game (if reachable) still shows the crew list. If standalone isn't reachable yet, note the
gate is in place and the path is untested-by-availability, not broken.

---

## 7. Global DO-NOT

- ❌ No migrations, no schema, no `games.modifiers` / `game_type_templates` touches.
- ❌ No surface-2, no back-stack, no toggle lock/confirms (phase d).
- ❌ No hardcoded hex; no Tailwind color utilities on themeable surfaces (STYLE_GUIDE §6).
- ❌ No hard deletes without an audit in the Phase 0 report.
- ❌ No new dependencies — reuse existing utilities (CLAUDE.md / reuse-don't-rebuild).
- ❌ Don't unify the global single-open accordion into per-section scoping.

---

## 8. Definition of done (all four tasks)

Per CLAUDE.md "what done means":
1. Each task implemented to its target behavior above.
2. Tests: any new/changed tRPC procedure gets a Vitest unit test; the Matches validity → gate logic
   gets a unit test; at least one Playwright happy-path covering open-game → fill matches →
   Enable-scoring enables.
3. Committed per-task with clear messages.
4. `npx tsc --noEmit` clean AND `next lint` clean.
5. No console errors in browser.
6. Eye-verified on real data (not just unit green): zones render, Matches derive+gate works, Total
   Points updates live, competition hides the roster while standalone keeps it.

**Then:** open the PR, summarize per-task what changed and the Phase 0 deltas found. Do not merge with
failing tests. After merge, the W-GAMEPAGE-01 doc's "already shipped vs remaining" delta should be
updated (separate housekeeping, not part of this PR's code).
