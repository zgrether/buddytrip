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

**`ghostCrew.ts:332`** — the `trip_members.status` update inside `ghostCrew.update`'s auto-link
branch, immediately after `rpc("link_guest_to_account", ...)`.

> **Line corrected 2026-08-01 (was `:330`).** The reference drifted two lines and `:330` now sits
> INSIDE the same block — so following this marker literally would have put an edit adjacent to the
> merge call, in the path every signup runs through. A stale safety marker is worse than none.
> **If you are reading this file at a later date, re-locate the site by its SHAPE** — the
> `trip_members.status` update immediately after `rpc("link_guest_to_account", ...)` — not by line
> number. That RPC is the documented wrapper
around `merge_guest_to_real_user`, the same function the `auth.users` signup trigger
(`handle_new_user`) calls on every real signup (see `CLAUDE.md`'s guest→real-user conversion
section). This site is classified MUST-FAIL-LOUDLY on its own terms — a zero-row result here would
mean a just-merged membership vanished mid-flow — but any fix must preserve the exact "merge first,
then set status" ordering and must not risk the merge itself. A bad edit here is the migration-023
class of failure: it can break every signup, not just this one code path.

---

## 4 · Findings

### 4.1 Highest severity — final results can vanish with zero signal

> **⚠️ CONFIRMED IN THE FIELD, 2026-08-01, and STILL UNFIXED ON `main`.** A full
> stroke round was played, Finish tapped, the summary rendered from the return
> value — and nothing appeared on the leaderboard, because the `game_results`
> write failed silently. This is no longer a reasoned-about severity; it is an
> observed production data-loss path.
>
> **The fix exists and is not merged.** PR #784 routes all three engines through
> the atomic `write_game_results` RPC and has been green since it opened; it is
> blocked only on the manual `supabase db push --linked` of migration 100.
> Nothing else in this audit is more valuable than landing it.
>
> Note the scores themselves survive in `score_entries` — the compute is
> idempotent, so re-finalizing after the fix should recover the round rather than
> requiring re-entry.

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

`setStatus` (`:762`) and `setPointsDistribution` (`:1127`, was `:1110`) check `error` but have no
existence pre-check anywhere in either procedure, unlike `enableScoring`/`disableScoring` in the same
file. A wrong/foreign `gameId` silently no-ops and still returns success. Also unchecked, lower
priority: `:817` (revert active matches to pending).

> **CORRECTED 2026-08-01 — the back-nine site (`:550`, now `:549`).** The original entry implied this
> needs an affected-row assertion. **It must not get one.** Re-read in context, the delete clears
> holes 10–18 when composing a NEW back nine, and its own comment says *"(A no-op on the first
> compose.)"* — **zero rows is the normal case**, not a failure. What it actually lacks is an `error`
> check: a real Postgres failure would leave the old nine's scores in place under a new stroke index,
> which does corrupt net scoring. So: check `error`, never assert a count. Filed under the same issue
> but as a different fix from its neighbours — this is precisely the over-correction the "legitimate
> zero-row" bucket exists to prevent, and the audit itself nearly caused it.

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

**Framed for decision 2026-08-01 — line numbers refreshed.** Each is now stated as
*what zero rows would mean here* and *what the user experiences under each answer*, because
"is zero rows OK" in the abstract is not answerable. **Zach decides; this frames.**

Two of the eleven have had their PERMISSION GATE WIDEN since the audit was written, which
raises the stakes on the answer — more people can now reach them.

| # | Site | What zero rows would mean | If we assert a count | If we leave it |
|---|---|---|---|---|
| 1 | `schedule.ts:175` reorder | a sent id isn't in this trip's schedule | a stale drag (item deleted in another tab) throws mid-loop, leaving a partial order | order silently partial; a re-drag fixes it |
| 2 | `schedule.ts:201` remove | the item was already gone | double-tap / two devices → an error on the second | user sees it vanish, which is what they wanted |
| 3 | `teams.ts:155` delete | the team was already deleted | same double-tap exposure | silent success on an already-gone team |
| 4 | **`teamAssignments.ts:154` remove** ⚠️ | the player wasn't on the team | a concurrent removal by another organizer throws | roster shows what they wanted either way. **Gate widened in #788 — Organizers reach this now** |
| 5 | `teamAssignments.ts:289` reorder | a sent user isn't assigned | roster changed mid-drag → throw, partial order | partial order, re-drag fixes |
| 6 | `quickInfoTiles.ts:132` delete | tile already gone | double-tap exposure | silent success |
| 7 | `ideaLodging.ts:180` delete | option already gone | double-tap exposure | silent success |
| 8 | `archivedIdeas.ts:112` delete | not in *your* archive (it is user-scoped) | a foreign/stale id becomes an error — arguably correct here, since it can only be your own row | silently succeeds on someone else's id |
| 9 | `datePoll.ts:440` returnToPoll | no `date_polls` row for this trip | a trip that never opened a poll throws on "return to poll" | reopens nothing, reports success |
| 10 | `matches.ts:547` play_groups cleanup | no orphan groups to clear | normal case throws — almost certainly wrong | orphan group stays visible to `listByGame` (§4.5) |
| 11 | **`ideas.ts:236`** single-pick clear ⚠️ | no prior vote — the FIRST vote, i.e. the common case | breaks every first vote — clearly wrong | a real failure could leave two active votes, **contingent on an unconfirmed `idea_votes` uniqueness constraint**. **Gate widened in #788** |

**The shape of the answer**, since ten of the eleven are the same question: these are all
"delete/update a thing the user just saw and asked to remove." The competing values are
*catch stale ids* versus *don't punish a double-tap*. A blanket count assertion makes every
concurrent-action race an error; leaving them all makes every stale id invisible.

**Two are not that question and can be settled independently:** #10 (`matches.ts:547`) and
#11 (`ideas.ts:236`) both have zero rows as their NORMAL case, so a count assertion is simply
wrong at both — they need only the error check they now have. #11's residual risk still
depends on the `idea_votes` constraint, which remains **unconfirmed** (checking it needs a DB;
`supabase start` has been unavailable). Unconfirmed rather than guessed at, still.

All eleven are error-checked or already were; only the count decision is open.

---

## 4bis · Resolved — what has been walked (2026-08-01)

A map that doesn't record what's been walked stops being one. Everything below
landed in one PR, one commit per issue, on top of a shared helper.

**`src/server/lib/assertAffected.ts`** is now the single idiom — `assertAffected`
(exact count), `assertAffectedAtLeastOne`, `assertNoError` (zero rows legitimate).
`grep assertAffected src/server` is the inventory of what has been made loud.
Deliberately a helper and not an RPC: #776 needed plpgsql for ATOMICITY, this
batch needs OBSERVABILITY, and wrapping one statement in a function makes nothing
more atomic. Its `count: null` case THROWS — a site that forgets
`{ count: "exact" }` must not look guarded while asserting nothing.

| Issue | Status | Sites |
|---|---|---|
| #777 | **resolved** | promote / demote / rollback — counts asserted; a failed rollback now says "may now have two Owners" |
| #778 | **resolved** | both roster inserts + the blast's send stamp |
| #779 | **resolved** | create rollback (logged), clear-before-rewrite, optOut (count), pre-delete |
| #780 | **resolved** | setPairings ×3, ensure-participant upsert, setHandicap ×4, removeMatch cascade, reorder loop |
| #782 | **resolved** | scores hot path, notifications, datePoll unlock pair, games ×4, ghostCrew ×2, playGroups ×3 |
| #781 | **framed, not decided** | the eleven — see below |
| #776 | **fix open, NOT merged** | see the warning under §4.1 |

**Three sites deliberately did NOT get a throw**, and each says why at the site —
they run inside an existing failure path where throwing would replace a better
diagnostic (`expenses.create` cleanup, `ghostCrew.create` rollback) or on a
non-privileged side effect of a write that already succeeded (`scores`' status
flip, where failing a scorer's entry over a status flag is the worse outcome).
Logged loudly instead. **Do not "finish the job" by converting these** — that is
the over-correction, not the fix.

**Nothing here became transactional.** `expenses.updateSplits`,
`matches.setPairings`, `matches.removeMatch` and `playGroups.setFoursomes` are
still delete-then-insert sequences where a throw partway leaves earlier writes
applied. Making a failure loud does not make it atomic. Atomicity for those
clusters is an RPC per cluster and its own piece of work.

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
