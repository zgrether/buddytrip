# Scale audit (Phase 0.5)

**Status: complete.** The audit stopped at a STOP point on 2026-11-16; Zach answered it the same day and the
fix list was written after. See "The STOP, and how it was answered".

- Spec: `docs/audits/SCALE_AUDIT_SPEC.md`. Read-only: no application code, schema, RLS or config changed.
- Commit read: `eae2b834e` (`origin/main`, 2026-11-16).
- Model: Fable 5.2 (the spec names 5.1).
- Where it ran: a scratch local Supabase stack (project `bt-scale-audit`, ports 583xx, CLI 2.78.1, all 229
  migrations replayed) and a production build (`next start`) on the same machine, 16 cores, database uncapped.
  Nothing ran against production, and no production figure in this document is new.
- New files: this report and `scripts/load/` (`lib.mjs`, `seed-scaffold.mjs`, `seed-games.mjs`,
  `seed-bulk.sql`, `load.mjs`). Every script refuses a non-local host.

**How to read the numbers.** Request and statement COUNTS are properties of the code and carry to production.
TIMES are local: no network between app and database, a fast uncapped machine. Production times will be
higher; by how much is unmeasured.

## The STOP, and how it was answered

The spec says to stop before the fix list if "the current plan's Realtime or connection limits are below
the target at a size BBMI could reach". That condition was met for messages per second.

**Production is on Supabase Pro (organisation `bbmi`), per Zach, 2026-11-16.** Whether the spend cap is on
was not stated; it decides which Pro column applies, so both are shown.

| Limit | Pro, spend cap on | Pro, spend cap off |
|---|---|---|
| Concurrent Realtime connections | 500 | 10,000 |
| Messages per second | 500 | 2,500 |
| Channel joins per second | 500 | 2,500 |
| Channels per connection | 100 | 100 |

Source: supabase.com/docs/guides/realtime/limits, read 2026-11-16.

| Fact | Evidence |
|---|---|
| One scoring reset of one 16-player stroke game writes **307 broadcasts in 150 ms** | measured, `games.resetScoring`, count of `realtime.messages` rows before and after |
| Finalizing that game writes **19 broadcasts** | measured, `games.finish` |
| Each broadcast is delivered once per subscriber, and Supabase counts every delivered message | Realtime limits doc: "An event is a WebSocket message delivered to, or sent from a client" |
| With 20 people on the board, one reset is 307 x 20 = **6,140 messages in under a second**: 12 times the capped Pro limit, 2.5 times the uncapped one | arithmetic; not measured against a Pro-sized tenant |
| A finalize is 19 x 20 = 380 messages: inside 500, but two games finalized in the same second are not | arithmetic |
| The local Realtime tenant runs at 200 connections and 100 events/s (the Free numbers) | `_realtime.tenants` on the scratch stack |
| There, at 20 watchers, 16 scores landing together (320 messages) tripped the limit: Realtime logged `MessagePerSecondRateLimitReached` 3 times and 3 of 18 such bursts reached **no watcher at all** (4,800 of 5,760 delivered) | measured, at the local limit of 100/s. On Pro's 500/s this burst fits |
| The same reset burst was delivered in full on another run (5,760 of 5,760) | measured: the limiter is not deterministic at this size |

So on Pro, a 20-person board is inside the limit for ordinary scoring and outside it for a reset. Nothing is
lost for good when it is exceeded: the 20 s game polls and the 5 minute board poll recover it (CLAUDE.md
#19, #20), which is why those polls stay.

**Zach's rulings on the STOP (2026-11-16):**

1. A bottleneck is fixed by redesign, never by a plan upgrade. A bigger plan may appear only as a stopgap
   with the redesign named beside it. (Zach cites `docs/design/REDESIGN_PLAN.md`, Principles. At
   `eae2b834e` that section says "Performance is a requirement in every spec" and does not state this rule
   in these words, so it is recorded here as his ruling; the plan should say it.)
2. The 307 broadcasts per reset are a trigger design problem, not a plan problem.
3. The spec's output rule contradicted itself ("a PR containing only" this file, and a load script
   "committed under `scripts/load/`"). One PR holding both is right.
4. The fix list leads with the score-visibility RLS finding (section 6), tagged Phase 1.

## 1. Every poll and subscription

Requests per hour are for one focused tab, 3600 / interval. Polls pause when the tab is hidden
(`refetchIntervalInBackground: false`, or the library default).

### Polls

| Screen | What it fetches | Interval | Per hour | Site |
|---|---|---|---|---|
| Any game view except pick'em | `games.configHash` (its own un-batched request, `src/lib/providers.tsx:118-123`) | 20 s | 180 | `src/hooks/useConfigSync.ts:68-75` and `src/hooks/useConfigDraft.ts:83-86`: two observers on one key in five of six views. They should share one request; not measured |
| Match | `scores.listByGame` | 20 s | 180 | `MatchGameView.tsx:330-333` |
| Match | `matchOutcomes.listByGame` (polled for score-mode games too, where it is always empty) | 20 s | 180 | `MatchGameView.tsx:339-342` |
| Rack | `scores.listByGame` | 20 s | 180 | `RackGameView.tsx:185-188` |
| Stroke | `scores.listByGame` | 20 s | 180 | `StrokeGameView.tsx:138-145` |
| Skins | `skinsOutcomes.listByGame` | 20 s | 180 | `skins/SkinsGameView.tsx:228-231` |
| Pick'em | `pickem.get` | 60 s | 60 | `PickemGameView.tsx:139-159` |
| Pick'em | `games.configHash` via `useConfigDraft` | 20 s | 180 | `PickemGameView.tsx:1118` |
| Cup board | `competitions.leaderboard` (off while a game panel covers it) | 5 min | 12 | `CompetitionLeaderboard.tsx:259-262`, `src/lib/queryConfig.ts:96-98` |
| Cup board / side games board | `games.sideBoard`, plus one fetch per reveal (`staleTime: 0`) | 5 min | 12 | `CompetitionLeaderboard.tsx:305-308`, `SideGamesBoard.tsx:39-42` |
| Match, Rack, non-golf header | `competitions.leaderboard`, same key | 5 min | 12, shared | `GamePageHeader.tsx:56-59`, `NonGolfGameView.tsx:164-167` |
| Cup settings open | `competitions.leaderboard`, same key | 5 min | shared | `CompetitionFace.tsx:279-282` |
| Chat open | `messages.list` limit 1 | 30 s | 120 | `src/hooks/useChatBackstop.ts:56-65` |
| Chat open | `messages.markViewing` (a write) | 15 s | 240 | `FloatingChatPanel.tsx:746-797` |
| Score entry with an unsynced cell | retry of that cell only | 30 s | 0 when nothing is unsynced | `src/lib/retryOnReconnect.ts:82-84` |

Per open game view, per hour: Match 552 (540 as a side game), Rack 372, Stroke 360, Skins 360, Pick'em 240,
non-golf 192. Add 360 with chat open. A stroke round of four hours with 16 phones on the game is
16 x 360 x 4 = 23,040 polled calls, before anyone enters a score.

Three timers make no request: `SettingsSaveBar.tsx:222-234`, `src/hooks/useNow.ts:39-77`,
`src/hooks/useSettingsRowLink.ts:26-40`.

### Realtime hooks (7)

All share one socket per tab (`src/lib/supabase.ts:22-29`).

| Hook | Topic | Mechanism | Ref-counted | Reports a dead channel |
|---|---|---|---|---|
| `useRealtimeScoreEvents` | `competition_events:{competitionId}`, or `trip_events:{tripId}` for side games | **broadcast**, event `score_changed` | yes | yes |
| `useRealtimeChat` | `trip-chat:{tripId}`, `team-chat:{tripId}:{teamId}` | postgres_changes, `messages` INSERT | yes | yes |
| `useRealtimeMembers` | `members:{tripId}` | postgres_changes, `trip_members` | yes | yes |
| `useRealtimeMyDelegations` | `my-delegations:{userId}` | postgres_changes, `game_delegates` | yes | yes |
| `useRealtimeGame` | `game:{gameId}` | postgres_changes, 7 tables on one channel | **no** | **no** |
| `useRealtimeCompetition` | `competition:{tripId}` | postgres_changes, `competitions` | **no**, and mounted twice (`page.tsx:218`, `LiveFaceClient.tsx:96`) | **no** |
| `useRealtimeTripData` | 3 topics, `tripdata:{table}:{tripId}` | postgres_changes, 3 tables | **no** | **no** |

One hook is broadcast; six are postgres_changes, over 13 published tables. Topics joined by one tab: 6 or 7
on the trip page, 9 or 10 on the cup board, 10 or 11 with a game panel open (the extra one is a team chat
room). Derived from the mount sites, not measured in a browser.

### Broadcast topics

One function, `broadcast_score_event()` (latest definition: migration 196). Payload is a signal only:
`{gameId, competitionId | tripId, kind}`, `private: false`. It fires once per ROW, with no WHEN clause, on
`score_entries`, `match_hole_outcomes`, `game_results` and `skins_hole_outcomes`, and on guarded updates of
`games`, `game_matches`, `bracket_matches` and `pickem_slate_games`. The per-row firing is what makes one
reset 307 messages.

What an event costs each open screen: the client waits 2 s (`src/lib/invalidationCoalescer.ts:107`) and then
refetches what is mounted. A board refetches `competitions.leaderboard`: **18.4 PostgREST reads per call**
(measured: 1,560 reads for 85 calls). A game view refetches its score list (about 3 reads).

## 2. Hot paths, measured

Taken in a browser as the trip Owner on the focus trip (40 members, one cup, 16-player stroke games, 6 of
them finished) with 20,002 games and 5.76 million score rows in the database. Counted with
`pg_stat_statements` and the gateway log; the instrument read zero on an idle 20 s window first.

| Path | tRPC HTTP requests | PostgREST requests | Statements | Database time |
|---|---|---|---|---|
| Open a trip (cold) | 4 (14 procedures) | 44 | 98 | 31 ms |
| Open the cup board (cold) | 5 (22 procedure calls) | 82 | 164 | 326 ms |
| Open a game panel from a warm board | 3, then 2 more on the first poll tick | 21 | 42 | 151 ms |
| Score one hole (4 scores, one phone) | 6: 4 writes and 2 score-list refetches | 27 | 54 | 29 ms |
| Finalize a 16-player game | 5 | 56 | 112 | 80 ms |

Notes:
- On the cold board, `competitions.leaderboard`, `competitions.faceBootstrap` and `games.sideBoard` each ran
  twice (two client batches a few hundred ms apart).
- Finalizing also runs the push and the clinch check after the response (36 service-role statements).
- These are Owner numbers. A Member's reads are slower, for the reason below. A Member's
  `competitions.leaderboard` took **1,204 ms median** called alone, on a database holding only the focus
  trip (11 games, 2,064 score rows).

RLS helpers on each path: every tRPC procedure checks membership once per batch in app code
(`trip_members` by `trip_id, user_id`). In the database, every table read calls `is_trip_member`; reads of
`score_entries`, `game_results` and the `game_started` view also call `has_trip_role`, `is_game_delegate`
and `can_score_unit` (next section).

### The three slowest statements, `EXPLAIN ANALYZE`

| Statement | No RLS | Owner | Member |
|---|---|---|---|
| `game_started` for the focus cup's 11 games (2,016 score rows behind it). Runs on every board load, every leaderboard compute and every game-panel open | 0.85 ms | 87 to 122 ms, 24,518 buffer hits | 320 to 447 ms on the small database; **816 ms** at 20,002 games |
| `score_entries` for one game (288 rows) | 0.18 ms | 13.6 ms | 47.0 ms |
| `game_config_hash_input` RPC (the 20 s poll) | n/a | 6.2 ms | not taken |

The same reads for a Member of a container holding 408 games (a stand-in for a crew that keeps its games):

| Statement | Time |
|---|---|
| `game_started` for its games (117,504 score rows) | **15,954 ms** |
| `game_results` for its games (7,344 rows) | 1,320 ms |
| `game_participants` for its games | 1,331 ms |
| `games` by trip | 15 ms |

The app aborts a database call at 8 s (`src/lib/fetchWithTimeout.ts:40`), so that board would not load.

## 3. Load test

`scripts/load/load.mjs`: N scorers enter a hole of four scores about a second apart, every 20 s; M watchers
each hold a Realtime socket on the board's broadcast topic and refetch `competitions.leaderboard` 2 s after
an event, as an open board does. Watchers are Members. Bar: under 1% errors, write p95 under 1 s, watcher
read p95 under 2 s, 99% of broadcasts delivered. 60 s per run.

**Red proof:** with PostgREST stopped mid-run the script reported `FAIL` (27.3% errors) and exited 1.

| Database | Scorers x watchers | Writes/s | Write p50 / p95 | Watcher read p50 / p95 | Failed reads | Delivered | Result |
|---|---|---|---|---|---|---|---|
| 20,002 games | 4 x 5 | 0.80 | 41 / 102 ms | 1,790 / 2,022 ms | 0 | 100% | fail (read p95) |
| 20,002 games | 4 x 10 | 0.77 | 40 / 2,020 ms | 1,780 / 3,105 ms | 0 | 100% | fail |
| 20,002 games | 4 x 20 | 0.45 | 4,046 / 9,871 ms | 11,799 / 24,044 ms | 50 | 100% | fail, 21% errors |
| 20,002 games | 4 x 40 | 0.28 | 8,832 / 17,433 ms | 19,345 / 27,586 ms | 335 | 100% | fail, 74% errors |
| focus trip only | 4 x 20 | 0.73 | 47 / 2,109 ms | 2,420 / 3,487 ms | 0 | 100% | fail |
| focus trip only | 4 x 50 | 0.28 | 7,358 / 11,784 ms | 16,720 / 23,193 ms | 378 | 100% | fail, 67% errors |
| focus trip only | 4 x 100 | 0.32 | 4,985 / 12,115 ms | 13,117 / 18,975 ms | 1,037 | 100% | fail, 85% errors |
| focus trip only | 8 x 200 | 1.33 | 45 / 1,672 ms | 3,689 / 6,403 ms | 1,363 | 40% | fail |
| focus trip only | 16 x 400 | 2.72 | 48 / 1,020 ms | 3,981 / 5,319 ms | 986 | 20% | fail, 200 watchers refused |

**Where it breaks, and on what:**

- **Request rate / database CPU: between 10 and 20 people watching one board while four groups score.** No
  run passed the bar. The limiter is one statement: across 85 Member leaderboard calls, `game_started` took
  152.9 s of 165.3 s of database time (92%). Leaderboard throughput topped out near 3 to 5 calls a second on
  16 uncapped cores. Production compute is smaller; the production break point is unmeasured.
- **Postgres connections: not the limiter.** Client connections peaked at 28 in every run. The app holds no
  Postgres connections of its own (section 7).
- **Realtime connections:** at 400 watchers, 200 were refused, exactly the tenant's 200.
- **Realtime messages:** delivery fell to 40% at 200 watchers and 1.33 writes/s (266 messages/s against 100).

Limits by plan (supabase.com/docs/guides/realtime/limits): concurrent connections 200 Free, 500 Pro, 10,000
Pro without spend cap or Team; messages per second 100, 500, 2,500; channel joins per second 100, 500, 2,500;
channels per connection 100. Production is on Pro. Against the target of thousands at once, capped Pro's 500
connections is one socket per open tab, so 500 open tabs; that is a spend-cap setting, and the redesign
question is messages per viewer, which sections 4 and 6 address.

What the script does not model: the 20 s polls, chat, the other nine topics a tab joins, browser batching,
network latency, and Vercel running many function instances where this ran one Node process. The single
process was not the limiter here (database time accounts for the latency), but that was not tested by
adding app processes.

## 4. Realtime for the redesign (recommendation)

One rule for all four surfaces: **broadcast from a database trigger, payload is a signal, the client
refetches through tRPC**, with the existing polls kept as the dead-socket backstop. No new
`postgres_changes` subscriptions, and the six existing ones move to broadcast as their screens are rebuilt:
each `postgres_changes` event is checked against RLS once per subscriber, which is the per-row cost in
section 6 paid again on the Realtime side.

| Surface | Mechanism and topic | Payload | Fallback poll |
|---|---|---|---|
| Live game | broadcast, `game_events:{gameId}`: scores, outcomes and config changes for that game | `{gameId, kind}` where kind is `score`, `config` or `lifecycle` | keep the 20 s `configHash` and score polls (#19) |
| Live board | broadcast, `competition_events:{competitionId}` (exists) | `{competitionId, gameId, kind}` | keep the 5 minute poll (#20) |
| Crew page | broadcast, `crew_events:{crewId}`: a game started, finished, was added or removed; membership changed | `{crewId, kind}` | 5 minutes, and refetch on reveal |
| Home | broadcast, one topic per person, `user_events:{userId}`, written when that person's home index changes | `{kind}` only | refetch on open and on focus; 5 minutes while open |

Three conditions, each from a measurement above:

1. **One broadcast per statement, not per row.** A reset or a finalize should send one signal. Today it
   sends 307 or 19, and the client throws all but one away after delivery, which is too late for the
   message limit.
2. **A board must not recompute standings per viewer per event.** 18.4 reads and a full recompute for each
   watcher is the request-rate break. Compute on write, or once per event and share it.
3. **Home must not join a topic per crew.** One topic per person keeps a tab's channel count flat however
   many crews someone is in.

Private channels are worth deciding in `CREWS_FOUNDATION.md`: today's topics are public and safe only because
the payload carries ids and nothing else.

## 5. Home

Today's nearest equivalent to one Home card is opening a cup board: 82 PostgREST requests cold, of which a
leaderboard is 18.4 and a structure read about 5. Building Home from today's queries costs, per container
with something live, at least one leaderboard and one structure read: about 23 reads. For someone in 5 crews
with 2 live things each that is 5 x 2 x 23 = **230 PostgREST reads per open**, each paying the RLS cost in
section 6, on every open by every user. One indexed read of a per-user table is 1.

**Recommendation: build the stored per-user "home items" index** (plan section 2), written when a game,
series, cup, trip or league a person can see changes state, and read with one query keyed on `user_id`. It
cannot be "one query" over today's tables: visibility is decided by RLS helpers per row, so a single SQL
statement across crews would still run those helpers on every candidate row. The index is also what
`user_events:{userId}` signals. Its write cost per change (one row per person who can see the item) is
unmeasured and belongs in `CREWS_FOUNDATION.md`.

## 6. RLS at scale

**Finding: reading scores as an ordinary member costs time in proportion to the number of score rows read,
and one common read also scans every game in the database.** Two causes, both visible in the plans:

1. `score_entries_write` is a `FOR ALL` policy, so it also applies to SELECT and is OR-ed with
   `score_entries_select`. For a Member it runs `can_score_unit(...)`, a plpgsql `SECURITY DEFINER` function,
   **once per score row** (2,016 loops at 0.113 ms in the Member plan). An Owner passes `has_trip_role`
   first and never reaches it, which is why the Owner is several times faster. `game_results_write`,
   `match_hole_outcomes_write` and `skins_hole_outcomes_write` are `FOR ALL` too.
2. For the second policy the planner builds a hashed sub-plan that reads **all of `games`** and calls
   `is_trip_member` and `has_trip_role` on each one: 580 ms at 20,002 games, with 19,994 rows thrown away.
   That cost follows the size of the whole product, not the trip.

The `game_started` view is where it hurts most: it is `security_invoker`, selects `DISTINCT game_id` from
`score_entries`, and so reads every score row of every game asked about just to learn which games have any.

This agrees with issue #1153 rather than contradicting it. #1153 measured the `score_entries` read at 5.7 ms
in production when the table held 558 rows, and concluded "not urgent" at that size. The per-row cost here
(0.05 to 0.2 ms) gives about the same figure at that size. What is new is the slope, and the whole-table
scan of `games`.

Helpers that run per row (all `STABLE`, `SECURITY DEFINER`, none wrapped as an initplan; called bare in
every policy). `is_trip_member` alone costs 11 microseconds a call (1,000 calls in 11.2 ms).

| Helper | Used by | Needs a crew-aware version | Index it uses or needs |
|---|---|---|---|
| `is_trip_member(trip_id)` | 56 policies on 41 tables | yes | has `trip_members (trip_id, user_id)` unique. Crew version: `circle_members (circle_id, user_id)`, already the primary key |
| `has_trip_role(trip_id, roles)` | 54 policies on 29 tables | yes | same |
| `is_trip_planner(trip_id)` | 15 policies on 9 tables | yes | same |
| `is_game_delegate(game_id)` | 17 policies on 11 tables | yes: it reaches membership through `games.trip_id` | has `game_delegates` PK and `games` PK |
| `can_score_unit`, `can_score_match`, `can_score_skins_grouping` | the three score write policies | no (participant-scoped), but the policies that call them change | `game_participants (game_id, user_id)` exists. `game_matches.side_a->>'id'` has no expression index (scan within one game) |
| `pickem_picks_open`, `pickem_picks_revealed`, `_pickem_can_proxy_for` | pick'em policies | yes, through `games.trip_id` | covered |
| `trip_chat_floor_allows` | `messages_select` | retired if chat goes | covered |
| `shares_trip_with_me`, `can_admin_guest` | `users` select and update | yes: becomes "shares a crew or has played with" | `trip_members (user_id)` exists; cost grows with the caller's number of containers |

Every policy on a game-scoped table is `EXISTS (SELECT 1 FROM games g WHERE g.id = <table>.game_id AND
is_trip_member(g.trip_id) ...)`. The redesign lets a game live in a crew with no trip, so all of them need a
second arm or, better, one "can see this game" answer that is decided once per query, not once per row.
`games.circle_id` and `competitions.circle_id` do not exist yet; `circle_members` exists as a stub whose
SELECT policy shows a person only their own row, and there is no `is_circle_member` helper.

Indexes missing beside the helpers (none blocks a helper lookup): `game_participants.play_group_id`,
`team_assignments` leading on `user_id`, `game_delegates` leading on `user_id`. Production's actual index
set was not read.

## 7. Connections and functions

**"Does everything go through the pooler?" is the wrong question for this app.** There is no Postgres
driver and no database URL in the application (`package.json:19-20`). Every server call is supabase-js over
HTTPS to PostgREST, GoTrue or Realtime, which hold their own pools: `src/lib/supabase-server.ts:5-35` (anon
key and the user's JWT, 8 s abort), `src/lib/supabase-admin.ts:17-33` (service role, 20 s abort),
`src/middleware.ts:35-54` (auth only). Load therefore shows up as HTTP requests queued on PostgREST's pool,
not as Postgres connections; the load test agrees (28 connections at every size). The numbers that matter
are PostgREST's pool size and the compute tier, both dashboard settings: unconfirmed. Supavisor is off
locally and in CI (`supabase/config.toml:38-39`). The only direct connections are the manual production
migration workflow and CI's own containers.

`maxDuration` is 60 on the tRPC route and on six REST routes (`src/app/api/trpc/[trpc]/route.ts:27`). No
page sets one. `vercel.json:3` pins functions to `pdx1`.

Work after the response, all through `afterResponse` (`src/server/lib/afterResponse.ts:49-58`):

| Trigger | Work |
|---|---|
| `games.finish` (`games.ts:1484-1511`) | game-finished push, then the clinch check, which recomputes the whole leaderboard |
| finishing a cup, `competitions.setTiebreakOrder` (`competitions.ts:655`, `:692-694`) | clinch or shared-first push |
| a roster change on a cup with results (`teamAssignments.ts:41-43`) | clinch check |
| first pick'em result (`pickem.ts:785-793`) | push |

Sent inside the request, awaited: chat push on every message (`messages.ts:688-697`), news push
(`news.ts:363-369`), all email, and the invitation blast, which awaits one Resend call per recipient in a
loop (`tripMembers.ts:1009-1037`). Every push is one outbound HTTPS call per device, all at once, with no
cap (`src/server/lib/sendPushToUsers.ts:242-269`). `reconcileClinchClaim`, also leaderboard-sized, runs
inside the request at seven call sites.

## Docs that are wrong

| Doc | Says | Code |
|---|---|---|
| `docs/design/REDESIGN_PLAN.md:39` | boards poll every 30 s | broadcast, with a 5 minute backstop (`src/lib/queryConfig.ts:96-98`). The other half of that row stands: each refetch still recomputes standings |
| `docs/design/REDESIGN_PLAN.md:43` | notifications such as game finished are sent inside the request | game-finished runs after the response. True for chat, news and email |
| `docs/design/REDESIGN_PLAN.md:44`, `docs/audits/SCALE_AUDIT_SPEC.md` question 7 | functions talk to Postgres; confirm the pooler | functions talk to PostgREST over HTTPS; there is no pooler to configure |
| `docs/design/REDESIGN_PLAN.md:40` | names chat as the `postgres_changes` user | five more hooks use it |
| `docs/audits/SCALE_AUDIT_SPEC.md` question 1 | "about 20" `refetchInterval` sites | 15 |
| `CLAUDE.md` #8 and #10 | "rides its 30s poll", "stale until the 30s poll" | 5 minutes; #20 in the same file is right |
| `CLAUDE.md` #19, `useConfigDraft.ts:11-12` | "all four game views" | six views |
| `CLAUDE.md`, Index Creation | `score_entries`, `game_results` "don't exist yet"; proposes an index on `score_entries (game_id, user_id)` | both exist and are indexed; `score_entries` has no `user_id` column |
| `ENVIRONMENT_AUDIT.md:194-197` | Vercel runs in iad1; no `vercel.json` | `vercel.json` pins `pdx1` |
| `DATA_FRESHNESS_AUDIT.md:197`, `:552` | leaderboard polls at 30 s; no subscription exists | both changed by migration 096 |
| `src/lib/queryConfig.ts:103-106`, `CompetitionLeaderboard.tsx:300-303` | side games get no push "until a trip-scoped topic exists" | migration 196 added it and the same file subscribes to it |
| `src/hooks/useRealtimeGame.ts:154` | "five tables" | seven |
| `FloatingChatPanel.tsx:770-771` | a viewer drops out "after ~2.5 min" | 40 s (`src/lib/chatViewHeartbeat.ts:71`) |

## Limits of this audit

- The bulk seed is stroke play only, cloned from six app-written games, so `game_matches` and
  `match_hole_outcomes` stay small and match-play reads were not measured at size.
- A bulk trip holds 408 games in one cup. No real trip does. It is used as a stand-in for a long-lived crew.
- The hot paths were taken once each, as Owner. They are counts with one timing, not distributions.
- Two observers polling `games.configHash`, and Match's two 20 s polls sharing a batch: read from code, not
  measured.
- No production number was taken: compute size, PostgREST pool, spend-cap setting, current row counts,
  indexes. The plan name is Zach's word, not a reading.

## Fix list

A list, not code. Each item: the problem, the evidence, the proposed change, and the spec it belongs to.
Phases are the plan's: 1 foundation, 2 game loop, 4 Home, 5 competitions, 6 trips.

No item proposes a plan change. Turning the Pro spend cap off would not cover the one burst that exceeds
the limit (6,140 messages against 2,500), so it is not offered even as a stopgap; item 3 is the fix.

### Phase 1: foundation (`CREWS_FOUNDATION.md`)

**1. A member's score read runs a function per score row and scans every game. Lead item.**
- Evidence: section 6. `game_started` for an 11-game cup: 0.85 ms without RLS, 320 to 816 ms as a Member.
  For a 408-game container: 15,954 ms, past the app's 8 s abort. 92% of database time in the load test.
- Why Phase 1: under D13 a crew's games are visible to the whole crew by default, and a crew keeps its
  games, so every member's read grows with the crew's whole history. The model has to rule this out before
  anything is built on it.
- Proposed shape:
  - **Visibility is decided once per game, never once per score row.** A read of scores, results,
    outcomes or participants asks one question, "which of these games may I see?", and the answer is a set
    of game ids found once per query. Score rows are then filtered by `game_id` against that set through
    the existing `game_id` indexes.
  - **That set comes from membership rows, by index.** Games in crews I belong to and that are not hidden
    from the crew, plus games I am playing in. It starts from my own membership rows (a handful), not from
    `games`. No plan may read all of `games`.
  - **Read rules and write rules are separate.** Today the write policies are `FOR ALL`, so "may I score
    this unit?" (`can_score_unit`) runs on every row a member reads. Who may write is asked only on a
    write, where it is one row.
  - **One answer for "can I see this game"**, used by every game-scoped table, so trips and crews do not
    each grow their own arm on 40 tables.
- Done when: on the seeded volume (`scripts/load/seed-bulk.sql`), `EXPLAIN ANALYZE` of the section 2
  reads as a Member shows no sub-plan looping once per score row and no sequential scan of `games`; a
  Member's read is within 2x of the same read without RLS plus one membership lookup; the 408-game
  container's board loads; `load.mjs` passes at 4 scorers and 20 watchers.
- Related: issue #1153 (the `auth.uid()` initplan rewrite). Still worth doing, and not enough on its own:
  the per-row cost here is the scoring function and the `games` scan, neither of which that rewrite moves.

**2. "Has this game started?" is answered by reading every score row.**
- Evidence: the `game_started` view is 78% of the cold board's database time and runs on every board load,
  leaderboard compute and game-panel open (section 2).
- Proposed change: store the answer on the game, written by the first score (any of the two score shapes,
  CLAUDE.md #27) and cleared by a reset. Compute on write, read one column.

**3. One reset sends 307 broadcasts; a finalize sends 19.**
- Evidence: "The STOP, and how it was answered". The trigger fires per row with no condition on four tables.
- Proposed change: **one signal per game per statement**, or debounced per game in the database. A
  statement that touches 288 score rows of one game says "this game changed" once. The payload stays a
  signal (ids and a kind, never scores, CLAUDE.md #20). The 20 s and 5 minute backstop polls stay
  (#19, #20). The client's 2 s coalescing stays as the second line: it protects the refetch, and this
  protects the message count, which the client cannot.
- Done when: a reset and a finalize each write one row to `realtime.messages` per game per topic.

**4. Every watcher recomputes the standings on every score.**
- Evidence: `competitions.leaderboard` is 18.4 PostgREST reads and a full recompute per call; with W people
  on a board, each 2 s window costs W of them. Leaderboard throughput capped at 3 to 5 calls a second.
- Proposed change: store standings when a result changes (the plan's "compute on write"), so a viewer's
  refetch is one indexed read of a stored row. The live projection is the hard part: it changes per score,
  so it is computed once per event for the board, not once per viewer. The model lands in Phase 1; the
  board that reads it is Phase 5.

**5. The per-user "home items" index, and its topic.**
- Evidence: section 5. About 230 PostgREST reads per Home open from today's queries, against 1.
- Proposed change: build the stored index in Phase 1 as the plan says, keyed on `user_id`, written when
  something a person can see changes state; signal `user_events:{userId}` on change. Measure the write
  cost per change (one row per person who can see the item) in the spec's Phase 0, at a 200-member crew.

**6. Membership helpers are trip-only.**
- Evidence: section 6 table. `is_trip_member`, `has_trip_role` and `is_trip_planner` sit in 125 policies;
  four more helpers reach membership through `games.trip_id`, which the redesign makes optional.
- Proposed change: crew membership answered from `circle_members (circle_id, user_id)`, its existing
  primary key; item 1's single "can I see this game" answer replaces the per-table `EXISTS` on `games`.
  Add the three missing indexes named in section 6 when the tables they serve are touched.

**7. Work done inside the request that grows with the audience.**
- Evidence: section 7. News push and all email are awaited in the request; the invitation blast awaits one
  send per recipient in a loop; every push is one outbound call per device with no cap.
- Proposed change: the plan's event queue. The request records the event; a background job sends, in
  bounded batches. Chat's in-request push goes when chat does.

**8. No list assumes a small container.**
- Evidence: `competitions.faceBootstrap` and `games.listByTrip` select every game of the trip, all columns
  (`src/server/routers/competitions.ts`, the `games` read in `faceBootstrap`). Fast at 408 rows (15 ms), but
  the payload and every list built on it grow with the crew's history.
- Proposed change: crew-scoped game lists are paged and filtered by state (live, upcoming, recent) in the
  query, per the Phase 1 guardrail.

**9. Correct the documents this audit replaces.**
- `docs/design/REDESIGN_PLAN.md` section 2: replace the table of today's problems with a pointer here; add
  the rule "a bottleneck is fixed by redesign, never by a plan upgrade" to Principles, where Zach cites it
  from.
- `CLAUDE.md`: the rows in "Docs that are wrong".

### Phase 2: the game loop (`GAME_LOOP.md`)

**10. Game config still arrives by `postgres_changes`, on a hook that is not ref-counted and does not
report a dead channel.**
- Evidence: section 1. `useRealtimeGame` binds seven tables; each change is checked against RLS once per
  subscriber. Three tables are signalled twice (published and broadcast).
- Proposed change: the live game gets one broadcast topic, `game_events:{gameId}`, carrying scores, config
  and lifecycle as kinds; the hook follows CLAUDE.md #22 (ref-counted, dead channel reported). The
  `configHash` poll stays as the backstop.

**11. The backstop polls fetch more than a backstop needs.**
- Evidence: 360 to 552 polled calls per open game view per hour; a four-hour round on 16 phones is 23,040
  calls before a score is entered. Match polls `matchOutcomes.listByGame` for score-mode games, where it is
  always empty. Two observers poll `games.configHash` in five of six views (unmeasured whether they share
  a request).
- Proposed change: keep every poll, and make the 20 s tick one cheap "has anything changed?" answer
  (config and scores) that triggers the full refetch only on a change, as `configHash` already does for
  config. Poll outcomes only for outcome-mode games. One `configHash` observer per view.

**12. The load test becomes the gate for this phase.**
- Evidence: no run passed the bar (section 3).
- Proposed change: `GAME_LOOP.md` names the bar and re-runs `scripts/load/load.mjs`. Before then, extend
  the seed to match play (so `game_matches` and `match_hole_outcomes` are measured at size) and take the
  hot paths as a Member.

### Phase 4: Home (`HOME_AND_NAV.md`)

**13. Home reads the index and joins one topic.**
- Proposed change: Home is one read of item 5's index and one subscription, `user_events:{userId}`, with
  refetch on open and focus and a 5 minute poll. It joins no per-crew topics, so a tab's channel count
  does not grow with the number of crews (today: 9 to 11 topics for one trip).

### Phase 5: competitions (`COMPETITIONS_STANDALONE.md`)

**14. The board reads stored standings and fetches each thing once.**
- Evidence: item 4; and on a cold board `competitions.leaderboard`, `competitions.faceBootstrap` and
  `games.sideBoard` each run twice (section 2).
- Proposed change: the board reads item 4's stored standings; one fetch per query on open.
  `useRealtimeCompetition` (competition row, `postgres_changes`, mounted twice without a ref-count) moves
  onto the board's broadcast topic as a `kind`.

### Phase 6: trips (`TRIPS_IN_CREWS.md`)

**15. Trip pages hold five `postgres_changes` channels.**
- Evidence: section 1. `members:{tripId}`, three `tripdata:*` topics and the trip chat room; the three
  `tripdata` channels are not ref-counted and ignore a dead channel.
- Proposed change: one broadcast topic per trip carrying a `kind` (itinerary, logistics, tiles, members),
  refetch on signal. Trip chat's channel goes with chat.
