# RLS Policy Audit — 2026-08-20

Read-only audit of every RLS policy in `public`, asking the #985 question per table:
**does this policy allow anything the procedures don't already do?**

The audit itself changed nothing: every write was executed inside a force-aborted
transaction and verified absent afterwards (see [Verification](#5-verification)). The
fixes came after, as migrations 133–140, and are recorded below.

**Status: all 12 findings closed, live in production at `20260821020000`.** Each was
verified individually against the running database after applying. This document is kept
as the record of what was found and what closed it — the next audit of this schema starts
from here rather than from scratch.

| | Finding | Closed by | |
|---|---|---|---|
| **F1** | `users_select USING (true)` — the whole user table, every email | mig **134** + [#1001](https://github.com/zgrether/buddytrip/pull/1001) | ✅ |
| **F2** | `users` `is_guest` write arm — global write on every placeholder | mig **133** | ✅ |
| **F3** | `invites` `FOR UPDATE USING (true)` | mig **136** | ✅ |
| **F4** | own split writable to any figure | mig **137** | ✅ |
| **F5** | splits addable to anyone's receipt | mig **138**+**140** + [#1008](https://github.com/zgrether/buddytrip/pull/1008) | ✅ |
| **F6** | `score_entries.submitted_by` forgeable | mig **136** | ✅ |
| **F7** | `match_hole_outcomes.submitted_by` forgeable | mig **136** | ✅ |
| **F8** | captain could swap roster members | mig **138**/**139**/**140** | ✅ |
| **F9** | captain could move a team between cups | mig **138**/**140** | ✅ |
| **F10** | game's competition could be another trip's | mig **135** | ✅ |
| **F11** | go-live state could be desynchronised | mig **135** | ✅ |
| **F12** | `trips_insert WITH CHECK (true)` | — | knowingly accepted (**#991**) |

**The standing guard is `src/server/routers/rlsAuditFindings.rls.test.ts`** — 28 cases,
every one driving a real JWT against PostgREST rather than tRPC. That is the audit's
central lesson made executable, and it is where the next narrowing should be pinned.

---

## 1. Method and harness validation

Probes ran against the **local Supabase stack**, driving RLS the way PostgREST does —
`SET LOCAL ROLE authenticated` plus `request.jwt.claims`, inside `BEGIN … ROLLBACK`
with savepoints so an expected refusal didn't abort the rest of the run. The acting
account was `test-outsider`, which holds no relevant membership.

**The harness was validated before any result was trusted**, because a probe that
silently fails to engage RLS reports "secure" for everything:

| Control | Expected | Observed |
|---|---|---|
| Outsider reads a foreign trip's messages | 0 | **0** |
| Outsider reads a foreign trip row | 0 | **0** |
| **Positive control — reproduce #985** (self-INSERT into any trip by UUID) | succeeds | **succeeded; chat became readable** |
| Same INSERT with migration 128 applied | refused | **refused** |

The local stack is at migration **127**. Migrations 128–132 are unapplied, and only
**128** touches a policy (`trip_members_insert`) — 129–132 are FK/column changes with
no RLS statements. That one delta was neutralised by applying 128's policy *inside* the
transaction (DDL is transactional), so `trip_members` was probed in its post-fix state.

> **Unconfirmed:** whether production's applied migration set matches `main`. This audit
> describes `main`. If prod is behind, prod is wider than what is described here.

---

## 2. Structural finding — an entire attack class is closed incidentally

While probing a suspected `trip_members` hole, a PostgreSQL rule turned up that governs
many of the verdicts below. Isolated in a synthetic table:

> **On `UPDATE`, PostgreSQL applies `SELECT` policies as a check against the NEW row.**
> A row cannot be moved out of your own visibility.

This closes the "pivot a row into another container via UPDATE" class wherever the
table's SELECT policy is container-scoped — cross-trip moves of `trip_members`,
`games`, `teams`, and `team_assignments` are all refused by this rule, **not** by any
deliberate guard.

Two consequences worth holding onto:

### 2.1 `trip_members` is protected by accident

`trip_members_update` is `USING (user_id = auth.uid() OR is_trip_planner(trip_id))` with
no `WITH CHECK`, and the role-guard trigger's STEP 1 returns early whenever `role` is
unchanged. Nothing on the UPDATE path stops a member repointing their own row's
`trip_id` at any trip in the database — #985 through a different verb. It is refused
**only** because `trip_members_select` is `is_trip_member(trip_id)`.

Migration 128's line 57 reads *"Untouched: self UPDATE and self DELETE. Members still
write their own row (travel, status, nickname)."* That reasoning is about **columns**,
and RLS is **row**-level. The conclusion happened to be right; the reason given for it
does not hold.

### 2.2 Widening a SELECT policy silently opens the matching UPDATE pivot

That coupling is invisible in the policy text — a future "let members see X" change is
also a "let members write themselves into X" change.

**Corollary: this protection does not exist where SELECT is `USING (true)`.** That is
exactly `users`, which is where the worst findings are.

---

## 3. Findings, ranked

Tiering follows A4: needing only an account is a different tier from needing existing
membership.

> **Every finding below is CLOSED** — see the table at the top for what closed each. The
> bodies are left in the present tense they were written in, describing the schema **as
> audited on 2026-08-20**, because the value of keeping them is the reasoning about how
> each gap arose and how it was proven. None of them describes production today.

### Tier 1 — any authenticated account, no membership required

#### F1. `users` — `users_select USING (true)`: the whole user table, including every email

*Confirmed by probe.*

Any browser JWT can `GET /rest/v1/users?select=*`. The probe returned **125 rows** with
every email address, no filter and no limit.

The only caller is `users.search`, which is deliberately the opposite — its own comment
says *"email-exact lookup only"*: it requires an `@`, does `.eq("email", query)` with
`.limit(1)`, and excludes self and guests. It is built as an existence check for an
address you already know, never a directory. The policy behind it is unconditional.

This is the #985 shape exactly: a careful procedure, a wide-open policy, and an app that
never does the thing the policy permits — so nothing fails.

#### F2. `users` — the `is_guest = true` write arm: global write on every placeholder

*Confirmed by probe, including the full chain.*

```
users_update  USING ((id = auth.uid()) OR (is_guest = true))   WITH CHECK: none → USING reused
users_insert  WITH CHECK ((id = auth.uid()) OR (is_guest = true))
```

The second arm is not scoped to a trip, so it spans every placeholder in the database.
Confirmed: renaming an arbitrary guest in an unrelated trip; rewriting a guest's email;
fabricating new guest rows with a chosen `id` and email. Correctly refused: promoting a
guest to a real account (`is_guest=false` fails the implicit check), and touching another
real user's row.

**It chains to unauthorized trip access.** `handle_new_user` matches a signup purely on
`email` + `is_guest = true`, then calls `merge_guest_to_real_user`, which reassigns every
reference — `trip_members` included — and deletes the guest. End-to-end probe:

| Step | Result |
|---|---|
| Outsider reads trip `reset-look` | denied (0 rows) |
| Outsider repoints guest `rl-guest-1`'s email to an address they control | **UPDATE 1** |
| Attacker signs up with that address (`INSERT INTO auth.users`) | merge fires |
| Attacker's brand-new account on `reset-look` | **`Member`** |
| Attacker reads the trip row / full roster | **1 row / 8 rows** |

F1 supplies the guest ids that F2 needs, so the two compose. No trip UUID is required —
unlike #985, which at least needed one.

> Precision: that trip has no messages, so "chat visible" read 0 both before and after.
> The proof of access is the trip row plus the roster, not a chat count.

### Tier 2 — requires existing membership of the trip in question

#### F3. `invites` — `"system can update invites" FOR UPDATE TO public USING (true)`

*Confirmed by probe.* From `001_initial_schema.sql`; never revisited.

No procedure updates `invites` — the sole UPDATE is inside the SECURITY DEFINER signup
trigger, which needs no policy at all. A plain Member rewrote their own trip's invite:
`role` `Member → Organizer`, `email` redirected, `accepted_at` cleared, token readable.

Anon and non-members are refused — not by this policy, but because the SELECT policy
won't surface the row to find. Impact is currently limited: `invites.role` is inert now
that #980 removed the client copy into `trip_members` and 128 closed the self-insert arm.
The `USING (true)` remains a live write primitive on a table nothing writes.

#### F4. `expense_splits` — `expense_splits_self_update`: arbitrary amount on your own split

*Confirmed by probe.* Set own split from `50.00` to `-9999.00`.

The only self-service caller is `optOut`, which writes `opted_out` plus `amount` of
exactly `0` or `null`. `updateSplits` is Owner-or-payer. A member editing their own
amount on a receipt they neither own nor paid is something no procedure does, and it
changes what other people are owed.

#### F5. `expense_splits` — `expense_splits_insert`: add splits to anyone's expense

*Confirmed by probe.* Added a `999.00` split for a third user onto an expense paid by the
Owner. The policy checks only `is_trip_member(expense.trip_id)` — nothing ties the row to
the caller or to an expense they control.

> Deliberately **not** reported as a gap: creating an expense that names someone else as
> payer. `expenses.create` is `requireTripMember` and takes `paidByUserId`/`splitAmong`
> straight from input, so the policy matches the caller. (Its comment says "Owner or
> Organizer" while the guard is `requireTripMember` — a doc/code mismatch, not an RLS gap.)

#### F6. `score_entries` — `submitted_by` is unconstrained

*Confirmed by probe.* Wrote a legitimate score for their own unit while stamping
`submitted_by` as the trip Owner. `scores.upsertEntry` always writes `ctx.user!.id`; the
policy never mentions the column. Provenance is deliberate here — migration 129 exists
specifically to preserve it — and it is forgeable.

Correctly refused alongside it: scoring another participant (`can_score_unit` held),
writing `game_results`, and editing own `handicap_strokes`.

#### F7. `match_hole_outcomes` — same unconstrained `submitted_by`

***Read from policy text only — not probed.*** Same column, same absence from the write
policy, same always-self procedure. Reaching it needs a match the caller is a side of;
that setup was not built.

#### F8. `team_assignments` — captain arm permits roster control

*Confirmed by probe.* A captain (a plain trip Member) replaced teammate `de-g1` with a
different user. `requireTeamIdentityEdit`'s comment is explicit: *"MEMBERSHIP stays
owner-only and does NOT use this gate — don't widen it: assign/remove players."* The
policy widens it. A non-captain member was refused the same edit, confirming captaincy is
what admitted it. With F1 supplying user ids, the substitute can be any account.

Blocked by constraints rather than by policy: transferring captaincy (unique
`team_assignments_one_captain_per_team`) and moving someone onto another team.

#### F9. `teams` — captain arm is not column-scoped

*Confirmed by probe.* `teams.update` permits a captain exactly four columns (`name`,
`short_name`, `color`, `color_dim`). The policy is row-level, so a captain also moved
their team into a **different competition in the same trip**. The cross-trip move was
refused (§2).

#### F10. `games` — `competition_id` can be repointed at another trip's competition

*Confirmed by probe.* A delegate reassigned their game's `competition_id` to a competition
belonging to a different trip, so its results would feed a foreign cup. Moving `trip_id`
was refused (§2) — but `competition_id` has no check at all. Available to any
Owner/Organizer through `games_write` as well.

#### F11. `games` — the go-live triple can be desynchronized

*Confirmed by probe.* Set `scoring_enabled = true` alone, leaving `status = 'pending'` and
`pairings_published_at` NULL.

CLAUDE.md #25: *"A game's three go-live signals move TOGETHER, always… There is no
legitimate state where one has moved and the others have not."* Every procedure writes all
three in one statement; the DB permits any combination. That entry notes the invariant
*"still has no test"* — this is a probe-confirmed instance of the risk it describes,
reachable by a delegate and by trip staff alike.

### Tier 3 — informational

#### F12. `trips` — `trips_insert WITH CHECK (true)`

*Confirmed by probe.* Any authenticated user inserts arbitrary `trips` rows. The row is
then invisible to them (`trips_select` requires `is_trip_planner` while
`locked_destination_at IS NULL`) and has no roster, so it grants nothing — but it is the
**#991** residual, and `trips` still has no ownership column to check against. Noted and
moved past, as instructed.

---

## 4. Per-table verdicts

`P` = confirmed by probe · `T` = read from policy text only

| Table | Policies | Verdict |
|---|---|---|
| `api_usage_daily` | SELECT `true` | **No gap** — `courses.apiUsage` is a bare `authedProcedure`; policy matches caller. T |
| `archived_ideas` | self ×3 | **No gap** — self-scoped, matches router. T |
| `bracket_entrant_members` | SELECT member · ALL Owner/Organizer | **No gap.** T |
| `bracket_entrants` | SELECT member · ALL Owner/Organizer | **No gap.** T |
| `bracket_matches` | SELECT member · ALL Owner/Organizer | **No gap.** T |
| `catalog_ideas` | SELECT `is_active` | **No gap** — reference data. T |
| `chat_reads` | self + member ×3 | **No gap.** T |
| `circle_courses` | SELECT via `circle_members` | **No gap** — no write policy; writes denied. T |
| `circle_events` | SELECT via `circle_members` | **No gap** — no write policy. T |
| `circle_members` | SELECT self | **No gap** — no write policy. T |
| `circles` | SELECT via membership | **No gap** — no write policy. T |
| `competitions` | SELECT member · INS/UPD Owner\|Organizer · DEL Owner | **No gap** — `co_admin` is narrower at tRPC; policy never wider. T |
| `courses` | SELECT `true` · write `created_by = self` | **No gap** — global by design (CLAUDE.md); `courses.create` is an unguarded `authedProcedure`. T |
| `date_poll_votes` | 9: self, ghost, owner_any | **No gap** — Organizer parity; all four arms moved together in mig 101. T |
| `date_polls` | SELECT member · INS/UPD Owner\|Organizer | **No gap.** T |
| `date_windows` | SELECT member · INS/DEL Owner\|Organizer | **No gap.** T |
| `expense_splits` | 5 | **GAP ×2 — F4, F5.** P |
| `expenses` | SELECT/INS member · UPD/DEL Owner\|payer | **No gap** — matches `create`/`updateSplits`/`remove`. P (refusals confirmed) |
| `game_delegates` | SELECT member · ALL Owner\|Organizer | **No gap** — a delegate cannot sub-delegate. T |
| `game_matches` | SELECT gated · ALL Owner\|Organizer · ALL delegate | **No gap** — matches documented delegate model. T |
| `game_participants` | as above | **No gap** — member edit of `handicap_strokes` refused. P |
| `game_results` | ALL Owner\|Organizer · ALL delegate · SELECT gated | **No gap** — member write refused. P |
| `game_type_templates` | SELECT `true` | **No gap** — reference data. T |
| `games` | SELECT member · ALL Owner\|Organizer · UPD delegate | **GAP ×2 — F10, F11.** P |
| `golf_courses` | SELECT `true` · INSERT any authed | **No gap** — `findOrCreate` has no trip guard; policy matches. P |
| `idea_lodging_options` | SELECT + ALL member | **No gap** — router uses `requireTripMember`. T |
| `idea_votes` | SELECT member · INS self+member · DEL self | **No gap.** T |
| `ideas` | SELECT member · INS/UPD/DEL planner | **No gap** — matches `requireTripRole("Organizer")`. T |
| `invites` | INS planner+role-split · **UPD `true`** · SELECT member | **GAP — F3.** P |
| `logistics_items` | SELECT member · ALL planner | **No gap.** T |
| `match_hole_outcomes` | SELECT member · write member/staff/delegate | **GAP — F7.** T |
| `messages` | SELECT + INSERT only | **No gap** — tight checks; no UPDATE/DELETE policy, so edits denied by default. T |
| `news_posts` | INS `author_id=self`+Organizer · UPD/DEL Organizer | **No gap** — authorship pinned, unlike F6. T |
| `news_reads` | self + member ×3 | **No gap.** T |
| `play_groups` | SELECT gated · ALL Owner\|Organizer · ALL delegate | **No gap.** T |
| `push_send_log` | **RLS on, zero policies** | **No gap** — fail-closed, service-role only. Correct. T |
| `push_subscriptions` | self ×4 | **No gap** — has its own RLS test. T |
| `quick_info_tiles` | SELECT member · write Owner\|Organizer | **No gap.** T |
| `schedule_items` | SELECT member · ALL planner | **No gap.** T |
| `score_entries` | SELECT gated · ALL member/staff/delegate | **GAP — F6.** P |
| `team_assignments` | 4 | **GAP — F8.** P |
| `teams` | SELECT member · INS/DEL Owner\|Organizer · UPD Owner\|captain | **GAP — F9.** P |
| `trip_members` | 4 + role-guard trigger | **No gap** — #985 closed by 128; role change blocked by trigger; `trip_id` pivot refused. **But see §2.1 — the pivot is blocked incidentally.** P |
| `trips` | SELECT CASE · INS `true` · UPD Owner\|Organizer · DEL Owner | **F12** (#991 residual). P |
| `users` | SELECT `true` · INS/UPD `id=self OR is_guest` | **GAP ×2 — F1, F2.** P |

All 45 `public` tables have RLS enabled; none was found unprotected.

**Grants provide no defense in depth.** Every table grants ALL to both `anon` and
`authenticated` (Supabase default), so RLS is the only barrier. Nineteen policies target
the `public` role rather than `authenticated`, which would make them anon-reachable — but
each gates on a helper resolving `auth.uid()`, so anon fails them. `invites`' UPDATE is
the one with no such gate, and anon is stopped by the SELECT policy instead (F3).

---

## 5. Verification

Every probe ran inside `BEGIN … ROLLBACK`. Afterwards, all artifacts were confirmed
absent and all baselines unchanged:

```
probe rows (users / auth.users / trips / expenses / invites / golf_courses /
            score_entries / game_participants / game_delegates / captains / _probe_t) = 0

users 125 · trips 94 · trip_members 182 · games 49 · score_entries 45
messages 60 · teams 83 · team_assignments 62 · competitions 64 · policies 126
```

Policies dropped/recreated inside transactions were confirmed restored to their original
text, and the helper function created for the migration-128 simulation is gone.

---

## 6. What this method could not see

Worth more than any individual finding, because it is what the next audit should do
differently. All three of these surfaced while FIXING, not while auditing.

**An enumeration of writers cannot see a writer that doesn't guard.** F11 took three
attempts. The first (CLAUDE.md #25's "all three columns move together, always") would
have broken finalize and score entry. The second — `scoring_enabled ⇒
pairings_published_at IS NOT NULL` — fits every write path and every row in prod and
local, was written as a CHECK, and broke 47 tests. What falsified it was `games.finish`,
which writes one of the three columns and guards on **none**: it will finalize a game
still sitting in `pending` and set `scoring_enabled` on the way past. Both wrong answers
came from asking "what writes these columns?", and the thing that mattered was invisible
to that question.

This is the same shape as migration 123's cascade DELETE. An audit organised around
**writers** cannot see a writer that doesn't guard; one organised around **columns**
cannot see an operation with no column list. Whatever axis the enumeration uses, the
counterexample lives off it — so the check that matters is *"what would be invisible to
the way I just enumerated this?"*

**Prod having zero rows in a state does not mean the state is unreachable.** Zero
`complete + scoring + never-published` rows in production meant nobody had taken that
shortcut yet, not that it was impossible. The test seeds producing it were reproducing a
real code path, not fabricating an impossible one — which is why the 47 failures were
information rather than noise.

**Both behaviour-change slips were caught by tests asserting exact values, not shapes.**
Migration 138's RPC was 1-based where the fan-out it replaced was 0-based;
`teamAssignments.test.ts` caught it only because it pins the exact indices, where a
"returns some order" assertion would have passed. Migration 140 reversed migration 094's
widening, which `captainReorder.test.ts` §5 pinned. CLAUDE.md prescribes grepping tests
for assertions of the old behaviour *before* pushing a behaviour change; both of these
were found by running the suite at the end instead.

One of those tests was then rewritten to assert the DATA rather than the ERROR —
"the row did not change" survives a boundary moving from `WITH CHECK` (raises) to `USING`
(silent no-op), where "this error was raised" does not.

---

## 7. Notes

- **The repo is public**, which shaped the whole delivery order: each migration was
  applied to prod BEFORE its PR was opened, so a public exploit description never
  described an unpatched system. This document was held out of the repo until the last
  finding closed, for the same reason.
- **Not probed at audit time, stated as such:** F7 only. It was later confirmed by probe
  when migration 136 closed it — with a real 1v1 match, signing a hole outcome as the
  opponent is refused and signing it as yourself succeeds. Everything else marked `T` is a
  *no-gap* verdict read from policy text where the policy is plainly no wider than its
  caller.
- **#991** reappeared exactly as predicted, as F12, and remains knowingly accepted. It is
  already public as an issue, so it is the one finding here that was never a disclosure
  concern.
- **`trip_members` is still protected by accident**, not by design — see §2.1. Nothing in
  this round changed that; it is now recorded as CLAUDE.md enforced pattern **#26** so the
  next person to widen that SELECT policy finds out before rather than after.
