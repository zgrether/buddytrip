# BuddyTrip / BBMI — Tracker (true state + strategy)

*The one map. Replaces `PROJECT_STATUS.md` (deleted — was pre-engine fiction). Strategy + true state,
**not** a trophy log — it earns its place by guiding what's next, not recording what's done. **This file is
the repo system of record for forward strategy;** CLAUDE.md's Document-Authority table points here for
"what's done vs next." Update it when state changes.*

**Ground truth = code.** Merges the consolidation audit (claim-side + CC code-side) with shipped reality.
Where a doc and the code disagree, code wins and the doc is flagged.

**The evaluation function (how everything is ordered):** two-tier test —
1. **Show up at BBMI 2026 FLAWLESS.** Perfect what's built before adding. A long polish period is wanted.
2. **Make it sticky** — good enough that the crew takes it home and spreads it.

Tier 1 outranks Tier 2. Within each, **structural before mechanical** (fix the root once; symptoms collapse).

---

## 1 · Roadmap status (ordered by the two-tier test)

### DONE — event-critical + adoption gate + safety net
- **Tier 0 bugs cleared** (`BBMI 2026` milestone 3/3): B1 9-hole match play (#405), B2 unknown
  `result_strategy` loud-fail (#406), B3 `RESEND_FROM` silent-misroute guard (#407).
- **Golf course API** (#414) — adoption gate shipped: golfcourseapi.com behind the existing contract,
  full per-tee record stored (ratings + per-hole), local-first two-stage search (killed the keystroke-API
  anti-pattern), daily UTC counter at the 50/day cap with manual-entry fallback, config-time tee selection
  into the scorecard snapshot. Manual entry remains the floor; scoring-time never calls the API.
- **E2E safety net** (#421) — one critical-path Playwright test (create trip -> crew -> competition -> game
  -> scores -> leaderboard), green in CI, **merge-blocking** (branch ruleset active), proven it goes red
  when the path breaks. The net the polish sweeps need.
- **Issue-tracking system** — 9 labels (type x priority), `BBMI 2026` milestone, capture-at-source +
  prune-at-seam discipline recorded in CLAUDE.md.
- **The bones-to-body competition redesign** — board row grammar, lifecycle state machine, two-phase config
  hub (all 3 formats), course/handicap conformance, stroke handicaps. Phase 1 fully closed.
- **R3 (canonical components)** (#422-#425) — ONE `Avatar` primitive + one pure `initials.ts` util, every
  variation a composing wrapper (the team-color disc is competition identity); plus the evidenced dead-code
  sweep (scoreboard subtree + `lib/scoring`). Audit-before-delete held throughout.
- **R4 (glossary)** (#426-#427) — ratified nomenclature into CLAUDE.md (home of record); `matches.activate`
  -> `enableScoring` (code-identifier); `game_organizers` -> `game_delegates` (table + its 2 policies + the
  `is_game_delegate` helper + 5 dependent RLS policies, atomic mig 061). Phase-0 re-verify found `round`
  already clean and `planner`->`organizer` already shipped (mig 029) — **2 of the 4 renames were no-ops.**

### NEXT — the polish period ("make BBMI FLAWLESS"; this IS the structural-first cleanup)
- **R2 (docs) — nearly done:** `PROJECT_STATUS.md` deleted; this tracker is the SoR; CLAUDE.md authority
  table points here; the base-branch-check rule landed. **Only remaining gap:** no root `README.md` exists
  (the audit flagged it) — write one as the polish period wraps.
- **Navigation system** (R3/R4-adjacent, Circle-compatible): declare the depth vocabulary (route /
  overlay / in-place), audit surfaces for back-button mismatches, define the desktop master-detail mapping
  (desktop != blown-up mobile). Parked until in R3/R4; design-doc first, build after. *Captured here, not
  yet an issue.*
- **WS4 — design reconciliation (Zach's pass, still owed):** each CD design -> hit/shortcut/missed/
  superseded vs shipped reality; folds into section 2.

### THE BIG REFACTOR — R1 (format architecture; the 2027-definer)
- **R1-D (design first):** format-agnostic lifecycle shell + template-driven registry (routing/grouping/
  handicap/readiness/points read from template columns or `config_schema`). Resolves the code-vs-data
  format-definition question (incl. the `game_type_templates` fetch-vs-enumerate perf item).
- **R1-I (implement, axis by axis):** migrate the 4 forked formats onto the base, one PR at a time.
- **Unlocks the golf-format library** (skins/stableford/scramble/sabotage as extensions, not forks).
- Best done last, on the clean/named/documented base R2-R4 produce.

### PARKED behind launch (per the ranking)
- **Money / gambling** — killer feature *only if* UI/UX nailed; no vision yet -> backburner (Nassau-with-stakes rides here).
- **Quick Game / Games-tab taxonomy** — DECIDE THE SHAPE (throwaway shortcut vs Circle-era generic
  non-golf scorekeeper), don't build; so R1's registry can accommodate the generic-game case.
- **Agenda/Lodging -> Bookings** — trip-owner UX simplification, big rework, low marginal value.
- **Circle / Thread pivot** — top-level object shifts trip -> Circle, trips become threads (post-launch).

---

## 2 · The architecture verdict (the BBMI-2027 question, answered)

**The four golf formats are four parallel implementations, not extensions of a base.** `result_strategy x
entry_schema x config` is honored in exactly one place (finish/post compute dispatch — now loud-failing
per B2); elsewhere format identity branches on hardcoded `gtt_*` ids; `config_schema` ships `'{}'`. Adding
a format today = ~10-13 files, ~7 forks -> **"2027 = huge effort" unless R1 lands.** The data model already
has the right shape; R1 is what makes 2027 an extension. This prices the roadmap: **the format library is
expensive until R1.**

---

## 3 · Ratified nomenclature (the glossary — consistency is load-bearing)

**Competition hierarchy (4 levels, Zach-ratified):** competition leaderboard (cup standings) -> game
scoreboard (one game's state) -> game score entry (entering scores) -> game scorecard (hole-by-hole).
Retire "hub"; decide whether "face" stays a *navigation* term (`CompetitionFace.tsx`) or folds.

| Concept | Canonical | Landmine |
|---------|-----------|----------|
| Unit of play | **game** + **match** (a pairing inside match-play) | retire "round" |
| Scoring-on / visibility | **enableScoring** / **Live** (first score) / reveal-Go-Live | `matches.activate` = same action, 2 names |
| Combatants | **team** (roster) / **side** (slot, may be solo) | preserve the split |
| Rights | Owner/Organizer/Member (trip) / co_admin (comp) / **delegate** (game) | pick one game-scope term: delegate |
| A person | member (trip) / participant (game) / guest (placeholder) | ghost-vs-guest grep hazard |
| Container | **competition** (code) / **cup** (UI) | fix stale "Events" copy |

---

## 4 · Standing principles

- **Code is ground truth;** docs reconcile to it, contradictions flagged not silently resolved.
- **Structural before mechanical;** fix the root, symptoms collapse.
- **Audit-before-delete is sacred** (`comparison_mode`, `merge_guest_to_real_user` both looked dead, weren't).
- **Verify the path you didn't test** (the recurring bug class; B1 was its 3rd instance).
- **Reuse-don't-rebuild** (Phase 0 caught the course-API "greenfield" that was 80% built — swap, not rebuild).
- **One gross->net path** (`netStrokeEntries`); derived values recompute, never snapshotted (except the
  intentional `scorecard_schema` config-time snapshot).
- **Capture discipline:** actionable-now -> GitHub issue (labeled, milestoned if bbmi-blocking); real-but-
  not-soon -> this tracker; sub-note -> append to its item; CC files at the source. Prune at the merge seam.
- **Circle-compatibility:** structural work stays Circle-compatible (don't reorganize twice), but doesn't
  reorganize *for* an architecture not yet designed.

---

## 5 · Open backlog references (issues + docs, not duplicated here)

- GitHub issues hold the hot, actionable set (compatibility gate + add-game UI filter; per-user tee
  assignment #416; BBMI-replay E2E #419; local-Supabase test-DB eval #420).
- `DEFERRED.md` holds: moving-tee tee-subset selection, desktop side-by-side tee display, and the standing
  pre-launch/v2 backlog.
- This tracker holds forward *strategy*; it does not re-list every issue.

---

*Living document. Update when state changes; strategy + truth, never a trophy log.*
