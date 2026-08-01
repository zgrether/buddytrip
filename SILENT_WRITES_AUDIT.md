# Silent Zero-Row / Unchecked Supabase Write Audit

**Date:** 2026-07-31 · **Auditor:** Claude Code · **Scope:** every mutating Supabase query-builder
call (`.update()` / `.delete()` / `.upsert()` / `.insert()`) in `src/server/` — 28 files, every one
that contains such a call. `.rpc(...)` calls are out of scope and excluded (see file-by-file notes
in the individual follow-up issues for the few that sit directly adjacent to a scored write).

**Trigger.** Filed as issue #774 after a one-off CI failure in `matches.test.ts`
(`assignPlayer — moving a player clears the vacated match's handicap`, "expected null, got 3") did
not reproduce on a second run. The failure's root cause was never confirmed — this audit does not
claim to have found it. What it found instead, while diagnosing that test, is a defect **class**:
a write whose failure (a real Postgres error, or a query that matches fewer rows than it should)
is invisible to the caller, which reports success regardless.

**Method.** Code is ground truth; every claim below cites `file:line`. Three parallel audits (batches
A/B/C, split by file) covered the 28 files; a fourth pass reconciled their classifications and
resolved terminology drift between them (see §4). No tests were run as part of the audit itself —
see PR #775 for what was separately verified for the one fix this effort produced.

**What this document is not:** a queue. It is the durable record of what the sweep found, so the
classification survives independent of any single PR's lifecycle. The actionable work is tracked in
GitHub issues (§5), which is where you go to pick something up — start there, come back here for the
full context on a specific site.

---

## 1 · What shipped alongside this audit

One fix, in the same PR (#775) as this document: `src/server/routers/matches.ts`, `assignPlayer`.
Both writes in its vacate loop — nulling the vacated match's slot, clearing both its players'
handicaps — had no error check and no affected-row check at all. Both now use `{ count: "exact" }`
and throw `INTERNAL_SERVER_ERROR` when the count doesn't match what should always hold (exactly one
match vacated; every vacated player's participant row actually cleared — `setPairings` always seeds
one per side member, so a mismatch means a participant row is unexpectedly missing). Two tests pin
this: one forces the "row unexpectedly missing" gap directly and asserts the call now rejects
instead of silently under-clearing; a companion pins the happy path is unchanged.

**Not fixed:** the two writes aren't transactional. A throw after the vacate-null succeeds leaves
that match vacated even though the overall call rejects. Pre-existing, out of scope for an
observability-only change.

Everything else below is reported, not fixed.

---

## 2 · Totals

| Batch | Files | Calls audited | Needs a fix | Ambiguous | Do-not-touch |
|---|---|---|---|---|---|
| A | `matches.ts`, `games.ts`, `datePoll.ts`, `trips.ts` | 81 | **26** | 2 | 0 |
| B | `tripMembers.ts`, `expenses.ts`, `ghostCrew.ts`, `ideas.ts`, `matchPlay.ts`, `playGroups.ts`, `news.ts`, `logistics.ts` | 56 | **32** | 1 | 1 |
| C | `schedule.ts`, `messages.ts`, `teams.ts`, `teamAssignments.ts`, `scores.ts`, `quickInfoTiles.ts`, `notifications.ts`, `ideaLodging.ts`, `competitions.ts`, `users.ts`, `matchOutcomes.ts`, `archivedIdeas.ts`, `strokePlay.ts`, `rackNStack.ts`, `golfCourses.ts`, `courses.ts`, `sendPush.ts` | 42 | **6** | 8 | 0 |
| **Total** | 28 files | **179** (+1 named site, fixed — §1) | **64** | **11** | **1** |

The remaining ~103 calls are fine as-is: either already guarded (§4's dominant convention — chaining
`.select().single()` after the write, which throws when nothing matches) or genuinely idempotent
no-ops (an upsert on a fixed conflict key can't legitimately affect zero rows; a "clear if present"
delete is fine at zero).

---

## 3 · ⚠️ DO NOT TOUCH — signup-trigger-adjacent

**`ghostCrew.ts:330`** — the `trip_members.status` update inside `ghostCrew.update`'s auto-link
branch, immediately after `rpc("link_guest_to_account", ...)`. That RPC is the documented wrapper
around `merge_guest_to_real_user`, the same function the `auth.users` signup trigger
(`handle_new_user`) calls on every real signup (see `CLAUDE.md`'s guest→real-user conversion
section). This site is classified MUST-FAIL-LOUDLY on its own terms — a zero-row result here would
mean a just-merged membership vanished mid-flow — but any fix must preserve the exact "merge first,
then set status" ordering and must not risk the merge itself. A bad edit here is the migration-023
class of failure: it can break every signup, not just this one code path.

---

## 4 · Findings

### 4.1 Highest severity — final results can vanish with zero signal

All six mutating calls in `src/server/lib/matchPlay.ts` are fire-and-forget (lines 197, 216, 219,
222, 367, 383), and the same delete-then-insert pattern repeats in `strokePlay.ts` (61, 63) and
`rackNStack.ts` (115, 128) — the write every scoring engine uses to persist final `game_results` on
finalize. A silent insert failure means a "finished" game ends with an **empty results table** and
no error anywhere in the chain — the leaderboard and standings simply vanish, after `games.finish`
has already flipped `status: 'complete'` (a write that IS checked). A silent pre-insert delete
failure means the next finalize (a correction → re-finish cycle) duplicates rows on top of stale
ones instead of replacing them.

This is directly adjacent to the scores-push wiring that shipped in #772: `notifyGameFinished` fires
after the status-flip write succeeds, with no knowledge of whether the compute step's own writes
(these) succeeded moments earlier in the same procedure — so a broken finalize could still produce
a "Final: {game}" push for a game with no results behind it. **Tracked in #776.**

### 4.2 `trips.ts` `transferOwnership` — zero or two Owners, undetected

Promote (`:319`) and demote (`:334`) both check `error` but not affected-row count; the
compensating rollback on a failed demote (`:342`) is entirely unchecked. A silent mismatch on either
of the first two can leave a trip with zero Owners or two. **Tracked in #777.**

### 4.3 `tripMembers.ts` `inviteByEmail` — success reported with no membership row created

Both insert branches (`:429`, `:523`) are completely unchecked. The invite email sends and
`"invited_new"`/`"added_existing"` returns regardless of whether the row was ever created — the
failure surfaces only when someone reports a dead invite link. **Tracked in #778.**

> **⚠️ This one went from latent to LIVE and back, which is worth recording.** #788
> widened `inviteByEmail` to `requireTripRole("Organizer")` while `trip_members_insert`
> stayed Owner-only (migration 101 deliberately did not widen it). So for an Organizer
> both inserts were *refused* — and because they are unchecked, the procedure returned
> `added_existing` / `invited_new` with no roster row, after already sending the invite
> email on the new-email path. Reverted to Owner-only in the follow-up PR.
>
> The lesson isn't "check the write" — it's that **an unchecked write is a loaded gun that
> a later, unrelated permission change can pull the trigger on.** This site was already
> catalogued here and tracked as #778; the sweep was right and the widening walked past it.
> When widening any guard, cross-reference this file for the procedure first: a finding
> listed here means a refused write will be reported as success.
>
> `sendInvitationBlast` has the same shape one severity down — its unchecked
> `last_emailed_at` UPDATE (`:765`) hits the same Owner-only `trip_members` policy, so the
> emails sent and the send-tracking silently didn't record. Also reverted.

### 4.4 `expenses.ts` — orphaned/duplicated financial split rows

Rollback (`:106`), clear-before-rewrite (`:178`), and pre-delete (`:280`) are all completely
unchecked; `updateSplits` (`:164`), `optOut` (`:235`), and `remove` (`:285`) check `error` but not
existence/count. Trip-shared money data — a silent failure here surfaces as a real disagreement
about who owes what. **Tracked in #779.**

### 4.5 `matches.ts` — everything beyond the named site

`setPairings`'s clean-replace (`:138`–`:140`, all three deletes unchecked), the `reorder` loop
(`:541`, per-match update unchecked), and `removeMatch`'s cluster (`:500` delete unchecked, `:503`–
`:504` clears unchecked, `:507`/`:510` participant deletes unchecked — whose failure lets a stale
row survive and then get preserved rather than overwritten by `assignPlayer`'s `ignoreDuplicates`
upsert at `:270` on a later reassignment — and `:511`'s orphan `play_groups` cleanup, which is
AMBIGUOUS rather than a clear defect, since the orphan stays visible to `listByGame`'s own query and
whether that's actually harmful is a product call). Also unchecked: the four `setHandicap` writes
(`:334`, `:340`, `:347`, `:353`) and the ensure-participant-row upsert (`:270`). **Tracked in #780**
(§4.10 below for `:511` specifically).

### 4.6 `scores.ts:134` — the one site in the per-hole scoring hot path

`games.status` flip (`pending → active`) via the admin client inside `upsertEntry`, completely
unchecked — not even destructured. Framed by its own comment as a race-tolerant fallback (a
concurrent score write may already have flipped it), which is a legitimate reason for the zero-row
case specifically, but a genuine failure is currently invisible and the game silently stays "Ready"
after a score already saved successfully. **Tracked in #782** — flagged for extra care given volume.

### 4.7 `notifications.ts:118` — `setPreference` on your own row

Real DB errors are checked; a zero-row match (which should never legitimately happen — always the
caller's own row) returns `{ok:true}` regardless. Small blast radius, same shape as everything else
here, and directly adjacent to the preference gate #772 wired up. **Tracked in #782.**

### 4.8 `datePoll.ts` — the unlock pair can dangling-reference a deleted window

Delete the zero-vote locked window (`:386`) and clear `date_polls.locked_window_id` (`:413`) are
both completely unchecked. If the first succeeds and the second doesn't, `locked_window_id` points
at a row that no longer exists. **Tracked in #782.**

### 4.9 `games.ts` — two procedures missing an existence check their siblings have

`setStatus` (`:762`) and `setPointsDistribution` (`:1110`) check `error` but have no existence
pre-check anywhere in either procedure, unlike `enableScoring`/`disableScoring` in the same file. A
wrong/foreign `gameId` silently no-ops and still returns success. Also unchecked, lower priority:
`:817` (revert active matches to pending) and `:550` (clear old back-nine scores — the comment
explicitly says these "belong to the old nine," so a silent failure corrupts net scoring under the
new index). **Tracked in #782.**

### 4.10 `ghostCrew.ts:191` — orphaned guest row on a failed membership insert

Rollback delete of a just-created guest placeholder, completely unchecked. If the rollback itself
fails, the orphaned guest row "can resurface stale name/email later." Distinct from `ghostCrew.ts:330`
(§3) — this one is a plain rollback with no signup-trigger connection. Also in this file, `:406`
(remove-guest delete) has no existence pre-check. **Tracked in #782.**

### 4.11 `playGroups.ts` — roster/handicap writes don't verify their target matched

Group-assignment (`:75`) and handicap (`:105`) updates check `error` but never verify the matched-row
count equals what was intended — a partial or zero match silently mis-assigns a foursome roster or
applies a handicap to nobody. The pre-rebuild delete (`:66`) is completely unchecked. **Tracked in
#782.**

### 4.12 Eleven sites needing a product call, not a mechanical fix

Same shape throughout: a plain delete/update by id, no count check, no comment settling intent —
zero-match could be a harmless race or a real stale-id bug:

`schedule.ts:175` (reorder) · `schedule.ts:201` (remove) · `teams.ts:155` (delete) ·
`teamAssignments.ts:149` (remove) · `teamAssignments.ts:284` (reorder) · `quickInfoTiles.ts:132` ·
`ideaLodging.ts:180` · `archivedIdeas.ts:109` · `datePoll.ts:435` (`returnToPoll`) ·
`matches.ts:511` (see §4.5) · `ideas.ts:229` (clearing a prior vote before casting a new one — zero
rows is legitimate, no prior vote — but a real failure could leave two active votes,
**contingent on an unconfirmed DB uniqueness constraint** on `idea_votes`; unconfirmed rather than
guessed at). **Consolidated in #781** for triage rather than filed individually — none of these are
independently actionable until the intent is settled.

---

## 5 · Where the work lives

| Issue | Cluster |
|---|---|
| [#776](https://github.com/zgrether/buddytrip/issues/776) | `game_results` silent failures — all three scoring engines (highest severity) |
| [#777](https://github.com/zgrether/buddytrip/issues/777) | `trips.transferOwnership` — zero/two Owners |
| [#778](https://github.com/zgrether/buddytrip/issues/778) | `tripMembers.inviteByEmail` — dead invites reported as sent |
| [#779](https://github.com/zgrether/buddytrip/issues/779) | `expenses.ts` — orphaned/duplicated splits |
| [#780](https://github.com/zgrether/buddytrip/issues/780) | `matches.ts` — everything beyond the named site |
| [#781](https://github.com/zgrether/buddytrip/issues/781) | 11 sites needing a product call, not a mechanical fix |
| [#782](https://github.com/zgrether/buddytrip/issues/782) | Misc: scores, notifications, datePoll, games, ghostCrew, playGroups |

---

## 6 · Existing convention (so a fix doesn't invent a third style)

The dominant pattern, used dozens of times already across nearly every router, is chaining
`.select().single()` after a mutating call — PostgREST throws when nothing matches, so the failure
is loud for free. The `{ count: "exact" }` + explicit comparison used for the one fix in §1 has
exactly one prior precedent in the codebase (`messages.ts`'s `clearChannel`, which captures the
count but doesn't itself assert it) — so it extends an existing idiom rather than inventing a new
one. No shared helper exists for "assert N rows affected, throw if not": `save_game_config`'s
stale-`baseHash` guard and `link_guest_to_account`'s owner-gated wrapper solve different problems
(optimistic concurrency; an RPC security boundary) and aren't reusable here. Given 64 sites need the
same shape of fix, a small shared assertion helper is worth building as part of whichever follow-up
picks this up first, rather than solving it ad hoc 64 times.
