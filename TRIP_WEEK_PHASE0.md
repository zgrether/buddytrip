# Phase 0 — what breaks under trip-week load

**Read-only against prod (`nezhuwyfirrbmyojpiyx`). No writes, no migrations, no
schema changes, no load test.** Code claims verified against `origin/main`
@ `9a80443`. Traffic measured from `edge_logs` (103,991 rows, 2026-09-02T10:40 →
2026-09-03T10:40 UTC), `postgrest_logs`, `postgres_logs`, Vercel runtime
logs/errors (7 days), and `pg_stat_statements` (cumulative since 2026-03-11 —
a 175-day window, so its means are long-run averages, not today's).

Scoped to BBMI 2026 where the question is trip-specific; where a number is
whole-project it says so.

---

## The answer in one paragraph

**The database is not the risk and cannot become it next week.** Every table on
the scoring path is under 600 rows, the whole app averages **1.51 ms** of
Postgres execution per call across 14.1 M calls, and the slowest thing in the
system by mean is a leaderboard view costing 63 ms. Sixteen people entering
scores will not strain any of it. The risk lives entirely in the two hops in
front of Postgres. First and by a distance: **Supabase's auth server
intermittently stalls, and it did so yesterday** — five token refreshes took over
25 seconds, one took **146.8 seconds**, and every one of them eventually returned
`200`. That is the same fault that produced 25-second dead pages on 2026-08-27
and 300-second hung requests on 2026-08-29. It has no identified trigger, no
fix on our side, and two of its three appearances were during evening hours.
Second, and steady rather than sharp: every Supabase call crosses the country
(Vercel in Ashburn, Supabase in Oregon), which is **~120 ms of the 122 ms
median** and is already filed as #933. Everything else I measured is healthy.

**The most useful output of this pass is not a fix. It is that the failure has a
recognisable signature** — the app goes quiet and slow *for everyone at once*,
scores keep saving, and it clears itself in under a minute. `RUNBOOK-TRIP-WEEK.md`
is written around that.

---

## 1 · The slowest things in the system

`pg_stat_statements` is available (1.11) and has not been reset since
2026-03-11.

### By total time — what dominates

Top of the `authenticated` role (the app's own path), 175 days:

| Query | Calls | Total | Mean | Max |
|---|---|---|---|---|
| `score_entries` game-id probe | 80,779 | 3,455 s | 42.8 ms | 1,986 ms |
| `trip_members` membership gate | 1,529,293 | 1,435 s | **0.94 ms** | 2,821 ms |
| `game_participants` read | 84,593 | 1,203 s | 14.2 ms | 1,253 ms |
| PostgREST `set_config` preamble | 6,977,268 | 1,046 s | 0.15 ms | 697 ms |
| **`score_entries` INSERT (the score write)** | **258,908** | **1,021 s** | **3.94 ms** | 2,595 ms |
| `match_hole_outcomes` read | 60,379 | 806 s | 13.3 ms | 1,263 ms |

Whole-role totals: `authenticated` 14,145,155 calls / 21,343 s = **1.51 ms
mean**.

### By mean time — what could time out

| Query | Calls | Mean | Max |
|---|---|---|---|
| `SELECT name FROM pg_timezone_names` (PostgREST schema reload, not a request) | 2,183 | 577 ms | 4,357 ms |
| **`game_started` view** (leaderboard) | 5,753 | **62.8 ms** | 2,315 ms |
| `score_entries` game-id probe | 80,779 | 42.8 ms | 1,986 ms |
| `save_game_config` and friends (RPC) | 3,666 | 38.6 ms | 1,907 ms |

`game_started` is the slowest thing the app asks for, and I dug into it because
it is the only query whose cost grows with how much the trip is played. Its plan
does **not** push the game-id filter down: all four arms (`score_entries`,
`match_hole_outcomes`, `pickem_slate_games`, `game_matches`) are sequential-scanned
and de-duplicated in full, then hash-joined against the requested ids.

**But it is still cheap, and I nearly reported otherwise.** My first
`EXPLAIN ANALYZE` showed a 558-row cached scan taking 57 ms, which would have
been a CPU-starvation finding. Re-run with `timing off`, the same scan is
**0.357 ms** — the 57 ms was `EXPLAIN`'s own per-row instrumentation. The honest
figures: **2.9 ms execution, 6.4 ms planning** as `postgres`.

The gap between that 9 ms and the 62.8 ms `authenticated` mean is RLS
evaluation. I did not isolate it (I cannot run as `authenticated` without
minting a JWT, which is a write to the auth system), so **"RLS costs ~50 ms on
this one query" is an attribution, not a measurement.** It is the only place in
the system where I found the advisor's `auth_rls_initplan` class costing
anything visible — see §6.

### The scoring path specifically

| Path | Calls (24h) | Mean | p99 | Max |
|---|---|---|---|---|
| `POST /rest/v1/score_entries` (write) | 21 | 161 ms | 395 ms | 422 ms |
| `GET /rest/v1/score_entries` | 3,896 | 159 ms | 891 ms | 2,425 ms |
| `GET /rest/v1/match_hole_outcomes` | 3,444 | 175 ms | 838 ms | 2,618 ms |
| `DELETE /rest/v1/match_hole_outcomes` | 22 | 348 ms | 1,185 ms | 1,232 ms |
| `POST /rest/v1/rpc/save_game_config` | 33 | 366 ms | 2,589 ms | 3,201 ms |

**The score write is the healthiest thing in the system.** 3.94 ms in Postgres,
161 ms on the wire, worst observed 422 ms, and 21 of them in a day.

---

## 2 · Timeouts, at every layer

All read from the live system, not from defaults I expected.

| Layer | Configured value | Where I read it |
|---|---|---|
| Postgres, role `authenticated` | **`statement_timeout = 8s`** | `pg_db_role_setting` |
| Postgres, role `anon` | `statement_timeout = 3s` | same |
| Postgres, role `authenticator` (PostgREST) | `statement_timeout = 8s`, **`lock_timeout = 8s`** | same |
| Postgres global default | `statement_timeout = 120000` ms | `pg_settings` (config file) |
| Postgres `idle_in_transaction_session_timeout` | **0 (disabled)** globally; 60 s for `supabase_auth_admin` | `pg_settings` |
| Vercel function `maxDuration` | **not configured anywhere** — no `vercel.json`, no `export const maxDuration` | grep of `src/`, `next.config.ts`, repo root |
| Vercel function ceiling, *observed* | **300 s** | `Vercel Runtime Timeout Error: Task timed out after 300 seconds`, 19× on 2026-08-29 |
| Vercel middleware ceiling | **25 s** | `did not return an initial response within 25s`, 22× Aug 6–27 |
| App's own auth guard | **2,500 ms** (`AUTH_TIMEOUT_MS`), slow-log at 1,000 ms | `src/lib/middlewareAuthTimeout.ts:60` |
| React Query queries | **`retry: 1`** | `src/lib/providers.tsx:83` |
| React Query mutations | **no retry** (library default; no `mutations` key in `defaultOptions`) | `src/lib/providers.tsx:76-85` |
| Score writes specifically | **`retry: 4`**, backoff `min(500·2^n, 8000)` ms | `src/hooks/useScoreSaver.ts:49,115` |
| Client fetch timeout (tRPC link) | **none** | `providers.tsx:117-127` — no `AbortSignal` |
| Server fetch timeout (Supabase clients) | **none** | no `global.fetch` override in `supabase.ts` / `-server.ts` / `-admin.ts` |

### If a score write hits a timeout, what does the user see, and is it lost?

**It is not lost, and this path is genuinely well built.** Verified in
`useScoreSaver.ts` and `scoreOutbox.ts`:

1. The value is written to a `localStorage` outbox **before** the mutation
   settles, keyed by the same `scoreCellKey(participantId, unitLabel)` the
   server upsert uses.
2. The mutation retries up to 4 times with exponential backoff.
3. On final failure the cell is flagged `error` and **keeps its value** — it is
   never rolled back to blank. The outbox entry stays.
4. On the next mount of that game, `outboxEntries` re-sends everything
   unconfirmed through the same idempotent upsert
   (`onConflict: "game_id,participant_id,unit_label"`), and the user is told
   *"Recovered N unsaved scores — retrying"*.
5. Advance and Finish gate on **save confirmation**, not on local completeness,
   so nobody can finish a round over unsaved cells.

**The two ways a score can still be lost, both worth knowing on the course:**

- **The outbox is per-device `localStorage`.** If a phone dies with unconfirmed
  scores and the round is re-opened on a *different* device, the recovery never
  runs. The scores are on the dead phone.
- **A terminal refusal retries forever** rather than surfacing — already filed
  as **#1230**, and the runbook names the symptom.

---

## 3 · Concurrency — the trip-week shape

### Connection headroom

| | Value |
|---|---|
| `max_connections` | **60** |
| `superuser_reserved_connections` | 3 |
| In use when sampled | **26** (7 PostgREST, 8 realtime, rest infra) |
| `shared_buffers` / `effective_cache_size` / `work_mem` | 224 MB / 384 MB / 2.1 MB |

PostgREST's configured pool maximum is **unconfirmed** — it is not in
`pg_settings` and the MCP surface does not expose PostgREST config. What I can
say is that 7 connections were held at sample time and I found **no
pool-exhaustion error in 24 hours** of `postgrest_logs`.

The `shared_buffers`/`effective_cache_size` pair is consistent with a ~1 GB
instance (Micro), but I could not read the compute tier directly, so treat that
as an inference.

### What serialises

**One thing, and it is not on the score path.** `save_game_config` takes
`SELECT … FROM games WHERE id = … FOR UPDATE` (latest at
`supabase/migrations/20260901120000_158_delegate_sets_points_total.sql:132`),
deliberately, to serialise concurrent settings saves. There are **no advisory
locks and no `LOCK TABLE` anywhere** in the migration set.

Consequence worth stating precisely: that lock is on the `games` **row**, so it
blocks another `save_game_config` and any `UPDATE games` for the same game — it
does **not** block score writes, which go to `score_entries`. The one contact
point is `scores.upsertEntry`'s pending→active status flip, which is an
`UPDATE games`. That flip happens **after** the score is already written, and
its failure is logged, not thrown (`scores.ts:154-162`). **So a settings save
held open while someone enters the first score costs a stale "Ready" badge, never
the score.**

### Does a leaderboard read block on a score write, or vice versa?

**No, in both directions.** Postgres MVCC readers do not block writers, the only
row lock in the schema is the one above, and all seven triggers on the score
tables are `AFTER` triggers running `broadcast_score_event` (verified against
`pg_trigger`). That trigger runs *inside* the write's transaction, so a slow
broadcast would extend the write — but the write's measured mean is 3.94 ms, so
it is not slow today.

### Two clients writing the same row

Last-write-wins, by design, and safe under retry: the upsert's
`onConflict: "game_id,participant_id,unit_label"` makes it idempotent
(`scores.ts:99-111`). A retry after a lost response re-applies the same value.

### Is sixteen people actually more load than we have seen?

**No — and this is the measurement I would most want checked.** The busiest
five minutes in the window carried **5,224 Supabase requests (17.4/s)**. A
modelled trip-week steady state is sixteen phones × 16 requests per 20-second
poll = **~12.8/s**. The observed peak already exceeds it.

And at that peak the system was **fine**: p50 121 ms, p99 3,381 ms, **one**
request over 5 s. Meanwhile a bucket at *half* that load (2,693 requests) was
the worst in the day — p99 7,266 ms with 96 requests over 5 s.

**Load does not predict degradation here.** I started this section expecting to
find a queue and the data refused it.

---

## 4 · The error paths nobody has walked

### The one that actually fires: a global stall

At **2026-09-02 21:29:30 UTC**, in a single 30-second window, **96 requests took
between 5.0 s and 7.7 s. Every one returned `200`.** They span every table
indiscriminately — including 48 hits on the `trip_members` gate, which is a
19-byte indexed point lookup whose mean is 0.94 ms.

That shape rules things out cleanly. It is not query cost (the queries are
free), not a lock (a lock blocks conflicting statements, not `SELECT`s on
unrelated tables), and not request volume (§3). Everything in flight slowed
together, briefly, and recovered. The app's own auth instrument caught the same
moment from the other side — three `auth-probe / slow` lines at 21:29:52-57 with
`elapsedMs` **1,889 / 2,118 / 2,149**, all near-missing the 2,500 ms guard.

**I could not identify the cause**, and I want to be plain that this is the
third time this app has met an unexplained stall. A checkpoint started at
21:30:13, *after* the window, so it is not that. The shape is consistent with
instance-level resource saturation (CPU credit throttling on a burstable
instance is the obvious candidate), but Supabase's compute metrics are not
reachable from the MCP surface and I will not assert it.

### The one that is dangerous: `/auth/v1/token`

| | 24h |
|---|---|
| Calls | 69 |
| Mean | **9,823 ms** |
| p99 | **146,295 ms** |
| Max | **146,767 ms** |
| Over 25 s | **5** |
| Status of those 5 | **all `200`** |

All five slow ones originated **server-side** — 2 from `Vercel Edge Functions`
(the middleware), 3 from `node` (tRPC functions). **Zero of the 40
browser-originated refreshes were slow** (max 1,096 ms). So this is the
Vercel→Supabase-auth path, not a phone on bad signal.

This is the same fault as the two prior incidents:

| Date | Symptom | Count |
|---|---|---|
| Aug 6 – Aug 27 | `/middleware` stopped at 25 s | 22, 5 users |
| **Aug 29, 14:15–16:54** | `/api/trpc` **timed out after 300 s** | 19, 1 user |
| **Sep 2, 21:00 UTC** | `/auth/v1/token` up to 146.8 s, all `200` | 5 |

The guards work as designed — `#1095` raced the middleware call and `#1140`
raced both calls in `createTRPCContext`, and there have been **no 300-second
timeouts since Aug 29** and **zero 5xx from Vercel in 24 hours**. But a guard
converts a hang into a degraded request; it does not stop the stall. And a
timeout in the middleware **skips the token refresh**, which is how the
`refresh_token_already_used` / `refresh_token_not_found` errors happen — 14 of
them across 2 users, most recently **today at 09:18 UTC**. Those are the errors
that look like "it logged me out".

### A request that succeeds after the client gave up

**No client-side timeout exists**, on either the tRPC link or the Supabase
clients. So the client never "gives up" on its own — it spins until the server
answers or the connection dies. For a score write this is safe (idempotent
upsert, §3). For a read it is a spinner. **The 300-second function ceiling is
therefore also the user-visible spinner ceiling**, which is what Aug 29 looked
like from a phone.

### The `baseHash` conflict on `saveConfig`

The refusal is good: `CONFLICT` → *"This game changed on another device — reload
before saving."* (`games.ts:1817`), deliberately worded differently from the
`STRUCTURE_MISMATCH` arm because only this one is transient.

**But the edits are lost.** `useDraftOutbox.recover()` returns the stored draft
*only if the server is unchanged since it diverged* — and on a `CONFLICT` the
server has by definition changed, so the reload the message asks for discards
the draft. That is correct behaviour (restoring a stale draft over a newer save
is worse), but it means **two people editing one game's settings at once lose the
second one's work**. It is in the runbook as a "don't".

### Silent-wrong vs visible-error

| Failure | Visible? |
|---|---|
| Score write fails | **Visible** — cell flagged, value kept, retried, recovered on remount |
| Auth stall (guarded) | **Silent** — request proceeds, refresh skipped |
| Auth stall → refresh token consumed | **Visible** — reads as a logout |
| Global 5–7 s stall | **Silent** — everything just feels slow, all `200` |
| `saveConfig` conflict | **Visible**, and the edits are gone |
| pending→active flip fails | **Silent** — game reads "Ready" while being played |
| `save_game_config` business refusal | **Visible with a real sentence** — the fallthrough at `games.ts:2010` strips the SQL code and keeps the human text (verified for `GLORIOUS_FROZEN`, which fired 3× yesterday and is the only 500 in 24h) |

---

## 5 · Vercel, on the longer retention

- **Error rate: zero 5xx in 24 hours.** 10,067 × 200, 92 × 404, 33 × 304,
  24 × 307, 18 × 207, 7 × 400, 3 × 412, 2 × 409, 1 × 408.
- **Functions approaching `maxDuration`:** the 19 × 300 s on Aug 29, none since.
- **Cold-start frequency: unconfirmed.** Vercel's MCP surface does not label
  cold starts and the runtime logs do not carry an init-duration field. I could
  not measure this and am not going to estimate it.
- The only recurring non-auth error is a `url.parse()` deprecation warning
  (44 occurrences, 13 users) from a dependency — noise.
- One `[sendPushToUsers] delivery failed … status: 500`, twice, on Sep 1.

---

## 6 · The advisor, re-ranked by trip risk

157 performance lints: 59 `multiple_permissive_policies`, 46
`auth_rls_initplan`, 42 `unindexed_foreign_keys`, 10 `unused_index`, across 44
tables. On the scoring/board path: `score_entries` (1 initplan, 1 permissive, 1
unindexed FK), `match_hole_outcomes` (1+1), `game_matches` (9 permissive),
`trip_members` (3 initplan), `pickem_picks` (3+2+1).

**Verdict: efficiency-only. None of them can cause a failure next week.** Stated
with the numbers rather than as an opinion, because the spec is right that a
null result needs its work shown:

| Table | Rows | Total size |
|---|---|---|
| `score_entries` | **558** | 1.8 MB |
| `match_hole_outcomes` | 226 | 272 kB |
| `game_participants` | 112 | 336 kB |
| `game_results` | 96 | 152 kB |
| `trip_members` | 73 | 944 kB |
| **`games`** | **42** | 216 kB |
| `game_matches` | 26 | 136 kB |

The `score_entries` INSERT — the exact statement the flagged policy guards —
means **3.94 ms** over 258,908 real calls. The `trip_members` gate, with three
initplan warnings on it, means **0.94 ms** over 1.5 M calls. A full scan of
`score_entries` is **0.357 ms**. There is no index missing that would move any
of this, because **an index on a 42-row table is slower than the scan it
replaces**.

### This contradicts a claim in #1153, and I think #1153 is wrong

#1153 argues the `score_entries` policy is *"the single largest per-row
multiplier in the schema"*, re-evaluating a `SECURITY DEFINER` helper
*"over a thousand times per read"*, and recommends landing an index **before**
the trip. The measured cost of those reads is **5.70 ms** (102,541 calls) and
**20.34 ms** (44,258 calls). A thousand nested definer-function calls cannot
happen in 5.7 ms. The mechanism it names is real; the magnitude is not, and the
pre-trip urgency does not survive it. **Posted as a comment on #1153 rather than
filed as a sibling** — and deliberately not acted on either way, since RLS
rewrites are out of bounds before Sep 13 and I agree they should be.

### The one place RLS does cost something

`game_started`: 9 ms as `postgres`, 62.8 ms as `authenticated` (§1). That is the
whole visible cost of the advisor's findings anywhere in the system, on a query
that ran 5,753 times in 175 days, on the leaderboard rather than the score path.

---

## Fix candidates — reported, not shipped

Per the spec I have written nothing but documentation. Each with blast radius,
and with what happens if it is wrong.

### A · Pin the Vercel function region to Oregon — **the real one, and it is #933**

- **Measured, which #933 could not do when it was filed:** 93,569 of 103,991
  Supabase requests enter Cloudflare at **IAD (Ashburn)**; Supabase is
  `us-west-2`. Median wire time **122 ms** against a Postgres mean of 1.51 ms —
  so **~120 ms of every Supabase call is the country.** A cold game-page open is
  ~33 such calls (measured on the companion branch's Phase 0).
- **An internal control, from the same 24 hours:** the same middleware workload
  entering at **SJC** has p50 **42 ms** against IAD's **84 ms**. n=33, so it is
  suggestive rather than decisive, but it points the way the model says it should.
- **Blast radius, and this is why I am not recommending it four days out:** it
  changes where every function runs, needs a redeploy, and *adds* latency on the
  client→function leg. The trip's own users are Southeast (the window shows
  Bluffton, Greenville, Atlanta, Charlotte, Miami, Cincinnati), so they would go
  from ~20 ms to ~70 ms to reach the function while saving ~120 ms per DB wave.
  Net almost certainly positive, but "almost certainly" is doing work there.
- **If it is wrong:** every request gets slower for everyone, and the fix is
  another redeploy. Recoverable in minutes, but it is a whole-app change on the
  Friday of a trip week.
- **Recommendation: not before Sep 13.** Measurement posted to #933.

### B · Bound how long a request can take — **new issue, low risk, still not urgent**

- `maxDuration` is unset (300 s ceiling) and **no Supabase client has a fetch
  timeout**. The auth calls got guards in #1095/#1140; the ~30 REST calls per
  request did not. A stalled REST call today can hold a function for five
  minutes and spin a phone for five minutes.
- **Not an observed live bug** — every 300 s timeout traced to the auth call
  that is now guarded, and there have been none since Aug 29. This is hardening.
- **If it is wrong:** too tight a bound turns a slow-but-working request into a
  failed one. On the score path that is safe (outbox + idempotent retry); on a
  read it is a visible error where there used to be a spinner.
- Filed, not shipped.

### C · Add an index on the scoring path — **there is nothing to add**

The eligible-fix category the spec anticipated is **empty**, and I want that on
the record rather than silently omitted. Every candidate table is between 26 and
558 rows; a sequential scan of the largest is 0.357 ms. #1153's index
recommendation is the one concrete version of this and §6 explains why I think
its urgency argument does not hold.

### D · Nothing on the scoring write path

Out of bounds by the spec, and I would not have proposed anything anyway — it is
the healthiest path measured.

---

## Code versus documentation — disagreements found, not resolved

Both are flagged here and changed in neither direction, per the spec.

1. **`CLAUDE.md` #25 vs `pg_db_role_setting`.** #25 discusses the lifecycle
   columns at length but nothing in it, or anywhere else in the repo's docs,
   records that `authenticated` runs with an **8-second `statement_timeout`**
   while the database default is 120 s. That is the hard ceiling on every query
   the app makes and it appears in no document. Not a contradiction — an absence
   — but it is the number the runbook needed most and it took a
   `pg_db_role_setting` read to find. *(Quoted: `CLAUDE.md`, Enforced Pattern
   #25. Against: `pg_db_role_setting` → `authenticated {statement_timeout=8s}`.)*

2. **#1153 vs `pg_stat_statements`.** Covered in §6. #1153 says *"over a thousand
   times per read"* and *"the single largest per-row multiplier in the schema"*;
   the statements it describes mean 5.70 ms and 20.34 ms. Quoted both ways in
   the comment on that issue. **I have not edited #1153 or the policies.**

3. Already filed by the companion Phase 0 and not re-filed here: `CLAUDE.md`
   #20's *"~40% standalone"* and #25's *"18 of 23"* are both false against prod
   (**#1254**).

---

## When a rule blocked me

- **"Do not run a load test against prod"** — so §3's concurrency answer is an
  *observational* one. I found a natural experiment (a 17.4/s burst) rather than
  creating one, and it happens to exceed the modelled trip-week rate, which is
  luckier than I had any right to expect. What I genuinely cannot answer is what
  happens at 3× that, and I am not going to find out this week.
- **Read-only** — so the RLS attribution in §1/§6 is an inference from the gap
  between the `postgres` plan and the `authenticated` mean. Isolating it needs a
  real JWT, which means writing to the auth system.
- **`get_advisors` returned 140 kB**, over the tool's limit. Parsed from the
  saved file with `node` rather than dropping the section.
- **Vercel's log API timed out** on every text search wider than ~20 minutes,
  which is why §4's auth-probe evidence is a single narrow window rather than a
  distribution. I checked the instrument could return data for that window
  before reading its silence elsewhere as "nothing happened" — an earlier
  24-hour warning query came back empty, and had I stopped there I would have
  reported that the guard never fired. It fired.

---

## What I did NOT measure

Stated so the all-clear is not read as wider than it is:

- **Cold-start frequency** — not exposed (§5).
- **PostgREST's configured pool maximum** — not readable from SQL (§3).
- **Supabase compute tier and its CPU credit balance** — the leading candidate
  for §4's global stall, and the one thing that would confirm or kill it.
- **Realtime under sixteen concurrent subscribers** — 55 `realtime_logs` rows in
  24 h is too few to say anything, and the broadcast contract tests are skipped
  in CI (**#1013**).
- **Anything at 3× the observed peak.**

---

## Issue ledger

**Opened**

- **#1258 — Nothing bounds how long a request can take: `maxDuration` is unset
  (300 s ceiling) and no Supabase client has a fetch timeout.** Meets the entry
  rule: there is a specific, mechanical version someone would pick up — set
  `maxDuration`, wrap the clients' `fetch` in `AbortSignal.timeout` — with the
  Aug 29 300-second incident as the worked instance of what it prevents.

**Closes on merge**

- None. This PR is two documents; it fixes nothing.

**Stays open, and why**

- **#933** — region hop. Now carries the measurement (~120 ms of a 122 ms
  median, plus the SJC control) but the fix is a deploy-shape change I am
  recommending against before Sep 13.
- **#1153** — advisor findings. Narrowed by §6's measurement, not resolved; the
  comment argues its magnitude claim is wrong and its pre-trip urgency does not
  hold. Whether to rewrite the policies is a Sep-14 question.
- **#1230** — outbox retries terminal refusals forever. Untouched; it is the
  one real gap in an otherwise sound score path, and it is named in the runbook.
- **#673** — 502s under concurrent load. Untouched and still open. Nothing in
  this window reproduced it (zero 5xx from Vercel, 3 × 500 from Supabase all
  being one designed business refusal), but "did not recur in 24 hours" is not
  "fixed".
- **#691** — auth blip surfacing as a 500. Adjacent to §4 but distinct: #691 is
  a network *failure*, and what I measured is a stall that *succeeds*. Left as
  its own thing rather than merged.
- **#1013** — CI skips the broadcast contract tests. Relevant to what I could
  not verify about Realtime.
- **#1252, #1097, #1214, #1253** — all steady-state efficiency, deferred to the
  Sep-14 spec by prior decision.
