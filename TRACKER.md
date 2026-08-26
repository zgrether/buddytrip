# BuddyTrip / BBMI — Tracker (true state + strategy)

*The one map. Replaces `PROJECT_STATUS.md` (deleted — was pre-engine fiction). Strategy + true state,
**not** a trophy log — it earns its place by guiding what's next, not recording what's done. **This file is
the repo system of record for forward strategy;** CLAUDE.md's Document-Authority table points here for
"what's done vs next." Update it when state changes.*

**Ground truth = code.** Where a doc and the code disagree, code wins and the doc is flagged.

**The evaluation function (how everything is ordered):** two-tier test —
1. **Show up at BBMI 2026 FLAWLESS.** Perfect what's built before adding. A long polish period is wanted.
2. **Make it sticky** — good enough that the crew takes it home and spreads it.

Tier 1 outranks Tier 2. Within each, **structural before mechanical** (fix the root once; symptoms collapse).

> **Reconciled 2026-07-25** against `main` @ #702. The previous revision described state as of ~#434;
> roughly 200 PRs had merged since. DONE below is deliberately compressed to ERAS — `git log` is the
> changelog, and a per-PR list would destroy the one property that makes this file worth reading.

---

## 1 · Roadmap status (ordered by the two-tier test)

### DONE — by era, not by PR

- **Pre-engine gates** (#405–#434) — Tier-0 bugs cleared (`BBMI 2026` milestone: 5 closed / 0 open), golf
  course API (local-first search, manual entry as the floor), first merge-blocking Playwright gate, the
  label+milestone system, R3 canonical components (ONE `Avatar`), R4 glossary into CLAUDE.md.
- **Competition engine — surfaces + lifecycle** (~#436–#547) — board row grammar + lifecycle states; reset
  primitives and danger zones at both scopes; rosters, captains, team identity; the config checklist and its
  accordion editors; modifiers; readiness gating; non-golf lifecycle page; the leaderboard redesign (hero,
  sections, completed-row grids, projection pills); scorecard preview + multi-tee display; and the
  persistent-board **game panel** idiom across all four formats.
- **Format architecture — first real de-forking** (#580–#588) — Refactor A collapsed 1v1/2v2 into ONE
  `gtt_match_play` (**golf formats 4 → 3**) + the owner-set Total points model; Refactor B added
  hole-outcome entry as a shared entry mode across golf and non-golf.
- **Game settings → draft-then-save** (#609–#652) — all four formats commit one composite draft through one
  atomic `save_game_config`; per-setting freeze redesign; lifecycle extracted into `useConfigDraft`;
  slide-over shell + canonical topology + aligned exit behaviour.
- **Durability + cross-device freshness** (#543, #563, #590, #684–#696, #702, #715) — per-hole and draft
  outboxes; config-hash reconcile poll + Realtime on game config; a whole-app fetch audit
  (`DATA_FRESHNESS_AUDIT.md`) and its cache-policy fixes. Recurring shape worth watching as a set: a table/
  query with no live-sync coverage, found incidentally by an unrelated task (F8→#695 for `tripMembers.list`
  route coverage, #715 for `team_assignments` lacking Realtime entirely) — three instances so far, check this
  set before re-deriving a fourth from scratch.
- **Platform, infra, planning, security** (#599–#604, #631–#643, #675–#696) — CI and local dev off shared
  prod onto ephemeral local Supabase (Step 0); README/CONTRIBUTING/Node pin; PWA install + web push; travel
  chips, itinerary Arrivals/Departures, lodging receipts, legal pages; tRPC 401 envelope + redirect sweep.

### NEXT — the polish period ("make BBMI FLAWLESS"; this IS the structural-first cleanup)

- **Pre-launch correctness** — the open `pre-launch` set is the live queue: prod 502 resilience under
  concurrent load (#673), Step-0 prod verification (#641), and the two settings-window defects (#701, #703).
- **Navigation system** — the design-doc-first half **landed**: `NAV_AUDIT.md` declares the depth vocabulary,
  maps the two-homes seam, and separates `[IA]` from `[PLATFORM]` findings. The build half is untouched;
  desktop master-detail is still unmapped. *Captured here, not yet an issue.*
- **Incomplete features** — see §5. That inventory is the input to ranking what's next; it is not itself a
  plan, and it is deliberately unranked.
- ~~**WS4 — design reconciliation**~~ — **COMPLETE** (closed 2026-07-25, Zach). Any future
  design-vs-shipped pass gets its own ticket rather than riding this standing item.

### THE BIG REFACTOR — R1 (format architecture; the 2027-definer)

R1's shape has changed under it — see §2. What remains:

- **R1-D (design):** the format-agnostic lifecycle shell + template-driven registry. **Narrowed:** the
  code-vs-data question this was meant to resolve is already answered — definitions live in code
  (`gameTypes.ts`, #438) and `game_type_templates` has no application reader left (archive nomination #440).
  What's left to design is the shell, not the registry's home.
- **R1-I (implement, axis by axis):** the settings/persistence/sync axis has effectively already migrated
  onto a shared base (§2). The **view + entry axis** is the one still forked, and is what R1-I now means.
- **Unlocks the golf-format library** (skins / stableford / scramble / sabotage as extensions, not forks).

### PARKED behind launch (per the ranking)

- **Money / gambling** — killer feature *only if* UI/UX nailed. **The "no vision yet" half is spent:** the
  side-bets handoff is the vision, and it is BUILT on Quick Play — bets as objects with a start hole
  (`src/lib/sideBets.ts`), presses derived rather than recorded, Nassau in one action, carryovers, the ☠️
  presses-on-presses option (linear — every press is another bet at the SAME stake, never a bigger one), and a live tracker that shows per-hole exposure without a tap. Deliberately Quick-Play
  only: a foursome, one card, one phone, nothing that rolls up to a cup — and the safe place to get presses
  and carryovers wrong, because finding the edge cases in a scratchpad costs nothing. What stays parked is
  the TRIP-side version (a bet that other people can see, that survives the round, that touches a
  competition) — and it stays parked until the rules have been played with, not until they have been
  specced further.
- **Quick Game / Games-tab taxonomy** — the surface moved to the dashboard strip (#559) and `/quick-game`
  exists; the format→game picker still needs trip-less game creation (#558). The SHAPE decision (throwaway
  shortcut vs Circle-era generic scorekeeper) is still owed, and still gates R1's registry.
- **Agenda/Lodging → Bookings** — trip-owner UX simplification, big rework, low marginal value.
- **Circle / Thread pivot** — top-level object shifts trip → Circle, trips become threads (post-launch).
- **Migration squash → single baseline** (CI/infra, post-September) — replace the ~90-file replay with one
  dump-generated baseline. Correctly deferred: it stops CI exercising individual migrations, which is exactly
  the per-migration replay gate that caught the 044 hardcoded-uuid delete. Keep the gate through the event;
  baseline once history is stable.

---

## 2 · The architecture verdict — re-evaluated (was: "four parallel implementations")

**The original verdict was half right, and the half that changed is the half that matters.**

*Held.* The **view + entry layer is still forked.** Four view components totalling ~5,800 lines
(`MatchGameView` 2,984 · `StrokeGameView` 1,245 · `RackGameView` 1,153 · `NonGolfGameView` 440), each with
its own payload mapper (`*DraftToPayload` / `*DraftsEqual`), and 14 hardcoded `gtt_*` branch sites across 6
non-test files (`gameRoutes.ts`, `gameReadiness.ts`, `scoreAccess.ts`, and the three golf views). Adding a
format still means writing a view.

*Overtaken.* A shared base **does** now exist — just not on the axis the verdict was written about:
- One draft-then-save lifecycle (`useConfigDraft`) and one atomic write (`save_game_config`) for all four.
- `GameConfigurationView`, `SettingsSaveBar`, `useGameSettingsOverlay`, `DiscardChangesPrompt` shared.
- `useScoreSaver`, `useConfigSync`, `useRealtimeGame` wired in all four.
- `BaseConfigDraft` with per-format extensions — a base with extensions, which is precisely the shape the
  verdict said didn't exist.
- Golf formats went **4 → 3** (#580), the first count reduction.
- `config_schema` shipping `'{}'` is no longer the live question: format definitions moved to code (#438)
  and the table has no application reader (#440).

**Net:** "four parallel implementations, not extensions of a base" is no longer accurate as a blanket
statement. Persistence, settings and sync converged; presentation did not. R1 is therefore **smaller and
more sharply scoped** than when it was written — it is a view-layer refactor now, not an everything refactor.

**Unconfirmed:** the original "~10–13 files, ~7 forks" price for adding a format was measured pre-R2/R3/R4
and has not been re-measured. Do not quote it as current.

---

## 3 · Ratified nomenclature

**Moved.** `CLAUDE.md`'s Glossary is the home of record and says so; this section previously duplicated it,
and the duplicate had already drifted (it still posed "retire hub" and "decide whether face stays" as open
questions that CLAUDE.md has since decided, and listed `matches.activate` as a live two-name problem after
the rename shipped). One glossary, one home. See `CLAUDE.md` § *Glossary — ratified nomenclature*.

---

## 4 · Standing principles

- **Code is ground truth;** docs reconcile to it, contradictions flagged not silently resolved.
- **Structural before mechanical;** fix the root, symptoms collapse.
- **Audit-before-delete is sacred** (`comparison_mode`, `merge_guest_to_real_user` both looked dead, weren't).
- **Verify the path you didn't test** (the recurring bug class; B1 was its 3rd instance).
- **Reuse-don't-rebuild** (Phase 0 caught the course-API "greenfield" that was 80% built — swap, not rebuild).
- **One gross→net path** (`netStrokeEntries`); derived values recompute, never snapshotted (except the
  intentional `scorecard_schema` config-time snapshot).
- **Capture discipline:** actionable-now → GitHub issue (labeled, milestoned if bbmi-blocking); real-but-
  not-soon → this tracker; sub-note → append to its item; CC files at the source. Prune at the merge seam.
- **Circle-compatibility:** structural work stays Circle-compatible (don't reorganize twice), but doesn't
  reorganize *for* an architecture not yet designed.
- **A doc can be wrong in two ways, and they fail differently.** *Stale* text lags reality, and any
  reconciliation pass catches it. *Never-true* text was wrong when written, reads as authoritative, and
  reconciliation **cannot** catch it — comparing a claim against now can't tell you it was always false.
  Worse, it can be self-defeating: `DEFERRED.md` once prescribed "gate on the hash" as the mitigation for a
  bug, and that guidance is exactly what caused it (#700). Only exercising the thing catches this class.

---

## 5 · Incomplete-feature inventory

*Started-but-unfinished, or built-but-unreachable. Evidence-based (`file:line`), sized S/M/L, and
**deliberately unranked** — ranking is Zach's call and the sizes are what that call needs.*

**How these were found.** The in-code idiom for a deferral is a **prose note in the doc-comment**, usually
naming the follow-on and often pointing at `DEFERRED.md`. There are **zero `TODO`/`FIXME`/`HACK`/`XXX`
markers** in `src/` or `supabase/` — CLAUDE.md used to prescribe `// TODO` for "someday" items, and that
rule was **deleted** in the same pass that built this inventory: a prescription with zero adoption that
nobody intends to adopt reads as authoritative and misleads, which is the never-true failure in §4.
Consequence worth knowing: prose notes are **not greppable** the way a marker is, so this inventory had to
be assembled by hand from that idiom, from `DEFERRED.md`, from open `feature`/`refactor` issues, and from
direct code inspection. Expect the same cost next time.

| # | Item | Built | Missing | Where | Size |
|---|------|-------|---------|-------|------|
| 1 | **Per-area domain colours** | Full palette exists as `--color-bt-domain-*` tokens | Every domain maps to teal; real values sit commented out beside each line. Forced a local duplicate map downstream | `src/lib/domainColors.ts:41` · dup at `ItineraryView.tsx:756` | S |
| 2 | **Per-tee ratings display** | Course/slope/bogey ratings fetched + persisted (mig 059) | Nothing renders them | `src/components/games/course/CoursePicker.tsx:33` | S |
| 3 | **Outcome-mode cell tap** | Tap-a-cell-to-jump works in score mode | Absent in outcome mode; hole nav is the stand-in | `src/components/games/MatchGameView.tsx:1417` | S |
| 4 | **Per-row stroke score gating** | Server + RLS reject the write | A member can still tap a co-player's cell and get a failure instead of a disabled cell | `src/components/games/StrokeGameView.tsx:219` | S |
| 5 | **Member entry-surface consolidation** | `MemberNotReady` + `SetupPlaceholder` both ship | Knowingly duplicated bodies; merge outstanding | `src/components/games/MemberNotReady.tsx:11` | S |
| 6 | **Non-golf game header** | Interim simple header | The cross-format projected-points header meant to replace it | `src/components/games/NonGolfGameView.tsx:51` | S |
| 7 | **Cart-mate cross-match scoring** | `canScoreUnit` is the clean widen point | Blocked on a match↔foursome data link that doesn't exist — needs schema | `src/lib/scoreUnit.ts:25` | M |
| 8 | **Competition delete: keep-games branch** | `delete_competition_cascade(p_delete_games=false)` implemented in SQL | Unreachable from the app; gated on an orphan-display UI that doesn't exist | `src/server/routers/competitions.ts:333` · mig 079:44 | M |
| 9 | **Server-side format-compatibility gate** | The add-game picker filters by `scoring_model` | No server rejection — an incompatible game can still be created by a direct call (#411) | `games.create`, no gate | M |
| 10 | **Zero-teams competition dead end** | `NoTeamsState` renders for every viewer | Early-returns before the games panel, so an owner whose team seed failed (create treats seeding as best-effort) has no in-place way out | `CompetitionLeaderboard.tsx:210,637` | S |
| 11 | **Legitimate-but-illegible states** | The states are correct | No copy explains them — e.g. Save grey during the `configHash` window (#703). Same family as an empty picker that is empty for a reason | `#703`, `SettingsSaveBar` | S–M |
| 12 | **Game-page server rendering** | Suspense spinner masks a 2–3s cold fetch | The actual fix (SSR the initial data) — explicitly the "half-fix" | `src/app/trips/[tripId]/games/loading.tsx:10` | M–L |
| 13 | **Modifier scoring engine** | Modifiers are recorded, and Glorious Holes computes | No general compute for the rest; per-modifier config not generalised | `src/lib/modifiers.ts:4` · `DEFERRED.md` Slice F | L |
| 14 | **Foursomes / alt-shot + four-ball** | Nothing | `group_holes` entry mode; the formats themselves | `DEFERRED.md` Slice C | L |
| 15 | **Player withdrawals** | Workaround: enter a score for the absent player | Any withdrawal model at all (#661) | `DEFERRED.md` | M |
| 16 | **2v2 per-individual handicaps** | Side-level handicaps | Per-player within a side | `DEFERRED.md` §2v2 | M |
| 17 | **Competition-style chooser** | `scoring_model` axis exists | style → format → points enforcement chain | `DEFERRED.md` | M |
| 18 | **Point value as competition-level weighting** | Per-game points | The defined-vs-weighted split (set points across all games late) | `DEFERRED.md` | M |
| 19 | **Alive-face cold-load animation** | Structure/state cut removed the blocking reload | The treatment for the one genuine cold wait (#451) | `#451` | S–M |
| 20 | **Non-golf declared-outcome visual refresh** | Functional control | Its own mockup pass (#504) | `#504` | M |
| 21 | **Touch-aware cross-container DnD** | Arrow-based reorder replaced DnD in match setup | Agenda cross-day + roster assign-by-drag still need touch DnD (#517) | `#517` | M |
| 22 | **Dark-mode lock** | `forcedTheme="dark"`, wiring kept for a toggle | The competition outdoor-mode toggle it was kept for | `src/lib/providers.tsx:109` | S |
| 23 | **Push: device unsubscribe** | Per-category mute (`setPreference`) works | `notifications.unsubscribe` has **no UI caller** (test-only) — no way to revoke a device subscription; endpoints accumulate | `notifications.ts:64` | S |
| 24 | **Non-destructive date-poll reopen** | `returnToPoll` preserves windows + votes | No UI reaches it — every clear-dates path calls the **destructive** `unlock`, which deletes zero-vote windows | `datePoll.ts:427` · `DatesSheet.tsx:135` | S |
| 25 | **Orphaned per-row game-config mutations** | `save_game_config` replaced them | ~17 procedures stranded with zero callers (all `matches` mutations bar `listByGame`, several `games.*`, `playGroups.setParticipantStrokes`). #630 tracks ~6 and **misses ~11** — and lists `setFoursomes`, which has a live caller | `matches.ts` · `games.ts` · `#630` | M |
| 26 | **Non-golf competition formats** | Head-to-Head; full persistence for all five (mig 086) | `bracket_se` / `bracket_de` / `best_of_n` / `live_results` are hardcoded-disabled "Soon" chips with no engine. **Deliberate** (docblock says don't implement; `GAME_FORMATS.md` §8 agrees) | `NonGolfConfigurationView.tsx:254` | L each |
| 27 | **News image upload** | Image/GIF block renders from a URL | File upload — despite a working Supabase Storage upload already shipping for lodging photos | `NewsComposer.tsx:737` | M |
| 28 | **Schedule is drag-only** | Drag-to-schedule + drop targets | No tap path: *"drag an item onto a day"* / per-day drop targets have no tap-to-add. Unactionable on touch, on a mobile-first app | `ScheduleTab.tsx:1271,1341` | M |
| 29 | **Empty states with no exit** | Correct empty copy | No affordance for a viewer who *can* act: teams panel after structure-lock, points matrix, "no crew to assign", transfer-ownership, news draw block, scorecard-without-course, archived ideas | see PR table | S each |
| 30 | **Orphaned read procedures** | Implemented + tested | `games.listTypes` (superseded by `gameTypes.ts`) and `competitions.teamAssignmentCounts` have zero callers | `games.ts:225` · `competitions.ts:160` | S |

**Not incomplete features — accepted limitations** (logged so they aren't re-litigated): the
`save_game_config` lost-update windows, Glorious Holes' `18−N` inertia, `pairings_published_at` redundancy,
`competition_points_earned` staying null, and the lodging-meta SSRF hostname-only guard. All in `DEFERRED.md`.

---

## 6 · Open backlog references (issues + docs, not duplicated here)

- **GitHub issues hold the hot set.** Live pre-launch: #673 (prod 502s), #641 (Step-0 prod verify), #701 /
  #703 (settings window), #451 (cold-load animation).
- **Environment / CI / onboarding:** `ENVIRONMENT_AUDIT.md` is the map. The Tier-1 build issues (#632–#635)
  are **all closed** (#640, #642); Step 0 (#420) shipped in #636.
- **Audits, each with a live follow-up queue:** `DATA_FRESHNESS_AUDIT.md` (F-items), `NAV_AUDIT.md`
  (`[IA]`/`[PLATFORM]`), `GAME_FORMATS.md` (format intent of record), `GAME_ROUTES_AUDIT.md`.
- `DEFERRED.md` holds the deferred features (§5 draws on it) and the accepted-limitation log.
- This tracker holds forward *strategy*; it does not re-list every issue.

---

*Living document. Update when state changes; strategy + truth, never a trophy log.*
