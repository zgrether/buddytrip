# Game Settings Draft-Then-Save — P1 FLIP (handoff)

Temporary working note. **Delete this file at P3.** Branch:
`refactor/game-settings-draft-save` (unpushed — migration 081 has NOT hit the
shared Supabase project yet; it applies on first push via CI's `db push`).

Authoritative spec: the "CC Spec — Game Settings: Draft-Then-Save Refactor"
Zach supplied. This note only covers the ONE remaining P1 step: **the flip.**

---

## ✅ THE FLIP IS DONE (`39daa98b` prep + `abfa57cc` flip)

`tsc` + `next lint` clean; 1190 unit tests green. All 10 work items landed.
**Read "Deviations" and "Open before PR" below — they change the plan as written.**

### Deviations from this plan (all deliberate)
1. **081 / the payload were REOPENED** (Zach approved; 081 is unpushed, so editing
   it in place breaks no migration history). The plan's freeze was incompatible with
   its own course work item: `ConfigDraft.course` / `SaveConfigPayload` / 081 had **no
   `back_course_id`**, so a drafted two-nines 18 could not round-trip — it would
   persist the composed schema and strand the back-nine identity, and clearing a
   course that had one would leave a stale ref rendering a phantom back nine.
   Added `backCourseId` end-to-end + a `COURSE_LOCKED` freeze guard in 081 mirroring
   `applyCourse` (refuse a course change once scores exist — **not** a destructive
   score delete), gated on an actual course change so a scores-retained game can still
   be saved. Also lifted `setBackNine`'s compose chain into the shared pure
   `buildComposedCourseSnapshot`, which the staging never prepared.
2. **Item 9's "merge returned rows" is not available** — `games.saveConfig` returns
   `{ ok: true }` (the RPC is `RETURNS void`). LEAN = invalidate `getById` +
   `listByGame` (both active here → they refetch) + mark the board stale.
3. **`pointValueByMatch` deliberately still reads `serverMatches`.** Item 3 lists it,
   but it feeds the OVERVIEW's projection — which renders only in scoring mode (draft
   frozen, server IS truth) and keys by SERVER match id, which a drafted match has
   none of. Repointing it at the draft would break the one screen it's used on.
4. **Two components the plan didn't list had to be converted**, or a live write would
   move the config hash out from under the frozen baseHash and make the user's own
   Save conflict: `EntryModeRow` (was `games.update` on tap) and **`GameIdentityHeader`**
   (was `games.update` on name blur + `addOrganizer`/`removeOrganizer` on pick).
5. **Delegates bug fixed in passing:** the mirror seeded `delegates: []` while 081
   REPLACES the list from the payload — every Organizer's Save would have silently
   revoked the game's delegate. The mirror now reads `games.listOrganizers`.
6. **First-setup points default** moved into the MIRROR (not a draft edit) so opening
   a fresh game doesn't read as dirty; it replaces the deleted reconcile's auto-seed
   and is established by the first Save (going live is always one).

### ✅ Also done since (PR #609 — draft)
- **081 is APPLIED** to the shared project (via the PR's CI `db push`, recorded under
  the correct filename timestamp). Note CI fires only on push-to-**main** / PR-to-main
  — a bare feature-branch push applies nothing, which is why the PR exists.
- **`games.saveConfig` now HAS its server test** (11 cases, green):
  `src/server/routers/games.saveConfig.test.ts`. ⚠ The baseline threading is the trap
  those tests document — `matchesDirty` is draft-vs-baseline, so passing an
  already-paired draft as its OWN baseline reports false, the RPC skips the match
  write, and go-live then correctly fails NOT_READY.
- **P1.7 done:** confirm-on-leave (`useGameSettingsOverlay` gates both exits; the
  popstate leg must re-push the entry it already consumed, or the SECOND back-press
  escapes) + the outbox now stores the WHOLE composite bundle, not just matches.
- **Two UI lies fixed, both found by Zach's eyeball:** the Save bar said "All changes
  saved" after Cancel, and `GameManagementPanel` claimed "The game is live" on a
  merely-STAGED flip (new `staged` prop).
- **The match-play E2E was rewritten** to the draft-then-save contract — it asserted
  persist-on-collapse. Its key assertion now INVERTS: nothing may reach the server
  before Save. Gate on the **"Saved" hint**, never on the Save button going disabled
  (it's disabled while saving too → resolves instantly and races the RPC).

### Open before merge
- **P1.8 gates (§5 1–12) not run.** Zach still by-eyes a seeded 2v2 on preview — now
  actually possible end-to-end (081 is live). 4/4 critical-path E2E green locally.
- **P2 untouched:** rack / stroke / non-golf still self-persist. Their components take
  the uncontrolled default, so they're unaffected — but they're the reason
  `GameRulesNote` / `CourseRowContent` / `GameIdentityHeader` / `GameSetupRows` keep
  their two-mode shape.
- **P3 dead code created by the flip:** `flushOnOverlayClose` + its `SettingsRow` /
  `CloseFlush` types (`src/lib/matchDraft.ts:110-141`) are now referenced ONLY by
  their own test — the mechanism they decided for is gone. Delete both with the test.
- **Known accepted gap:** `save_game_config` stores `NULLIF(strokes, 0)`, so "no
  handicap" persists as NULL where the old `setHandicap` wrote 0. Behaviourally
  identical (`effectiveStrokes` → `?? 0`); don't "fix" it, and don't assert the
  encoding in tests.

### The one-value rule, and how it was nearly lost (keep this)
The outbox `base` and Save's `baseHash` are ONE value — both read the single
`serverHash` binding off `games.configHash`, frozen on the same `anyTouched`
transition. The composite outbox first shipped keyed on the MATCHES fingerprint
instead, which silently defeats the concurrency check: a remote COURSE change leaves
the matches fingerprint equal, so the outbox restores, the baseline re-seeds to the
newer server at mount (nothing is touched yet), Save's check passes, and the
recovered draft overwrites the other device. Both guards say "fine" about different
states — exactly what the constraint exists to prevent.

The trap that motivates the wrong fix: the hash is async, and comparing a stored base
against `""` while it loads DELETES a good outbox entry. The remedy is to GATE on the
hash (`enabled` requires it; the seed effect waits for it — and must gate the WHOLE
effect, since the server seed fills `draft` and the `draft.length > 0` guard would
then stop it ever re-entering to recover), never to key the outbox off something
else. Consequence to know: a `configHash` failure now blocks the matches seed. That's
consistent (Save is disabled without a baseline anyway) but it means the row renders
empty rather than erroring — worth a nicer failure if it's ever seen in the wild.

---

## State: everything under the flip is landed, green, behaviour-preserving

| Commit | What |
|--------|------|
| `03a4e3f8` | P1.1 pure `configDraft` trio (`src/lib/configDraft.ts`) + tests |
| `ef573c90` | P1.2 atomic `save_game_config` RPC (migration 081) |
| `42065f8f` | 081 `FOR UPDATE` row lock |
| `1b85946a` | P1.3 part 1 — composite read-seam (`configDraft` memo; `effectiveTotal` + `courseResolved` read it) |
| `6097c74d` | P1.6 server — `games.saveConfig` front door |
| `69cb3ff5` | staging — `MatchPointsRow` → presentational (reconcile OUT of the component) |
| `692ca1d9` | staging — `GameRulesNote` optional controlled mode; match page opted in |
| `3e37fca3` | staging — `buildCourseSnapshot` shared pure derivation (`src/lib/courseSnapshot.ts`) |
| `d4fc3f48` | staging — `CourseRowContent` optional controlled mode (props inert until the flip) |
| `3c2d5166` | audit fixes 1–5 (see below) |

`tsc` + `next lint` clean; 608 unit tests green.

### Why the staging exists
Each self-persisting child editor was converted to **controlled**, with
`MatchGameView` temporarily holding adapters that reproduce today's writes
**verbatim**. Those adapters are what the flip DELETES. The risk is concentrated
in one small flip instead of a 40-edit blind rewrite of the game spine.

**There are exactly two temporary adapters in `MatchGameView`, both clearly
comment-banded `TEMPORARY — draft-then-save staging`:**
1. the **points write adapter** (mutations + `persistEvenShare` + `bumpPointsBoard`
   + the reconcile lifted verbatim + `localTotalRef`) → **delete; P1.4 falls out**
2. the **rules blur adapter** (`rulesDraft` + `commitRules` + `updateGameM`)

---

## Audit findings already fixed (do NOT re-fix)
1. **`readGameConfigHash` queried `.from("matches")` — no such relation.** Fixed to
   `game_matches`, and ALL four queries' errors are now checked. This had silently
   broken #16 sync AND would have let `saveConfig`'s conflict check pass while
   clobbering another device's pairings.
2. `configDraftToPayload` now **establishes** `points_distribution` on first setup
   (gated on `isMatchPlayFormat` via the read-only `ConfigDraft.gameTypeId`) —
   replaces the reconcile seed the flip deletes.
3. Points adapter redistributes against the optimistic stepped total (`localTotalRef`).
4. `saveConfig` name floor `z.min(1).max(200)` + SQL `NULLIF(btrim(...))`.
5. Match clean-replace runs only when `payload.matchesDirty`, and is **refused once
   score rows exist** (either entry mode) — `HAS_SCORES`. This is what keeps
   disable→re-enable working (disable KEEPS scores).

### Accepted, logged, do not "fix"
`FOR UPDATE` gives write serialisation, **not** lost-update prevention — the hash is
validated outside the lock, so a sub-100ms A-checks/B-checks/A-writes/B-clobbers
window stays reachable. Accepted deliberately; documented in 081.

---

## THE FLIP — the only remaining P1 step

Client-only. `081` / payload / hash are **frozen** — don't reopen them.

### Design decision that makes it tractable
**Do NOT restructure `draft` in place.** `const [draft, setDraft]` lives at
`MatchGameView.tsx:149`, *before* the `serverConfigDraft` memo (~line 530), so
promoting it directly forces a reorder and cascades. Instead:

- `serverConfigDraft` (existing memo) = the server mirror.
- Add sibling slices, `null` = untouched: `pointsDraft`, `courseDraft`,
  `entryModeDraft`, `nameDraft`, `delegatesDraft`, `scoringDraft`.
  (`draft`/matches, `modifiersDraft`, `rulesDraft` already exist.)
- `configDraft` = memo assembling the slices **over** the mirror → the ONE object
  every derivation and Save reads.

### Frozen baseline + baseHash (Zach's constraints — non-negotiable)
- Capture the **baseline composite AND a server-produced `configHash` TOGETHER at
  seed time**, and **freeze both under `draftTouched`**. The `useConfigSync` ~20s
  poll must NEVER refresh the baseHash while the draft is dirty, or the conflict
  check defeats itself (A saves → my poll lands → my base becomes A's post-save
  hash → my Save passes → I clobber A).
- **Outbox `base` and Save's `baseHash` are ONE value** — capture once, feed both,
  or recover-vs-discard and conflict-vs-allow will disagree about what the base was.
- Use the **server-produced** hash (`games.configHash` query, already fetched by
  `useConfigSync` — same query key, so it shares cache, no extra round-trip). Do NOT
  recompute client-side; it must be byte-identical to what `saveConfig` re-derives
  via the shared `readGameConfigHash`.
- `dirty = !configDraftsEqual(configDraft, frozenBaseline)`.

### Work items
1. Slices + assembled `configDraft` memo + frozen baseline/baseHash (above).
2. Repoint handlers at the slices; **delete both temporary adapters**.
3. Repoint the remaining §1 two-store derivations at the draft: `pointsMatches` /
   `matchCount` denominator, `pointValueByMatch`. (`effectiveTotal` +
   `courseResolved` already read the composite.) Overrides key off the DRAFT match,
   not the server match id — that coupling is why P1.3-points/P1.4/P1.5 are one unit.
4. Convert `EntryModeRow` (it's page-local, defined at the bottom of `MatchGameView`).
5. Thread course through `GameSetupRows` → `CourseRowContent`'s new callbacks
   (`onApplyFront` / `onApplyBack` / `onRemoveBackNine` / `onClearCourse` / `busy`);
   the page computes the snapshot with **`buildCourseSnapshot`** and drafts
   `{ id, scorecardSchema }`. Course CANNOT be deferred — a course applied straight
   to the server while the rest drafts gets REVERTED by Save writing the draft's
   older course back.
6. Multi-open panels (drop the single-open accordion; `changeOpenRow` /
   `persistDraftOnCollapse` commit paths go). Row open/close = pure UI state.
7. Full-page shell + **Save at top** (Primary per `STYLE_GUIDE §5`, inline styles —
   no shared `<Button>`), Cancel = Ghost. Save enabled only when dirty; "Saving…"
   while pending; keep the panel open on error with a banner that renders the
   **readiness failure** legibly (`PRECONDITION_FAILED` from the in-RPC assert).
8. Save → `games.saveConfig({ tripId, gameId, baseHash, payload })` where
   `payload = configDraftToPayload(configDraft, frozenBaseline)` (baseline arg is
   what makes `matchesDirty` honest).
9. **Conditional cascade:** no `scoring_enabled` change → LEAN (merge returned rows
   into `getById` + invalidate `faceBootstrap`/`listByTrip`; **no board
   `gameQ.refetch`**). A save that FLIPS `scoring_enabled` (either direction) → run
   the full board cascade. `commitReady`'s `saveSetup()`+`enableScoring` two-step
   collapses into Save.
10. Tidy `GameRulesNote`'s implicit `value !== undefined` mode signal (audit #6).

### Preserve (spec §2.6 — these are NOT the problem)
`settingsEditable = canEdit && !scoringEnabled`; per-row `locked={scoringEnabled}`;
server `entry_mode` freeze; result/complete freeze
(`locked = complete && !corrections_open`; `computeMatchPlayResults(…, {skipComplete:true})`);
`useGameEditAccess`; `isOwner` for Danger Zone; the `draftTouched` guard (now over
the whole composite).

### Do NOT
- Let any row write the server before Save.
- Leave a derivation reading `serverMatches`.
- Reopen 081 / the payload / the hash.
- Touch `matches.setHandicap` / `matches.setPointValue` — they are the **corrections
  late-edit path**, deliberately separate and unchanged. The RPC's `scoring_enabled`
  guard governs the settings-Save ONLY; that separation is what makes gate 6d hold.

---

## After the flip
P1.7 (3-layer flush repurposed + composite outbox + confirm-on-leave — none exists
today; build at `useGameSettingsOverlay.closeConfig` + `useModalBackButton`), then
P1.8 gates (§5 1–12) + PR. **Zach by-eyes a seeded 2v2 on preview** — CC cannot reach
one. Then P2 (rack/stroke/non-golf onto the same model), P3 (cleanup; retire
CLAUDE.md #17; flag #1's `onMutate` drift; delete this file).
