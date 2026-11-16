# Audit spec: scale (Phase 0.5)

**Model:** Fable 5.1 (one deep pass; the Realtime design is hard to undo). **Read-only.**
**Output:** `SCALE_AUDIT.md` at the repo root, on branch `audit/scale`, as a PR containing only that file.
**Base:** current `main`. Record the commit you read.

## Why

The redesign (`docs/design/REDESIGN_PLAN.md`, section 2) targets thousands of people at once setting
up games, scoring and watching, and moves everything into crews: a per-user Home built from every
crew, crew pages, live boards opened from Home. Section 2's table of today's problems was written from
docs in early November and is partly out of date (for example, the 30s leaderboard poll was replaced
by DB broadcast, CLAUDE.md #20). This audit replaces that table with measured facts and a fix list
that feeds `CREWS_FOUNDATION.md` and every later spec.

## Method

- Code and the live schema are ground truth. Every claim cites `file:line` or a migration. Where a doc
  disagrees with code, the code wins and the disagreement goes in a "Docs that are wrong" section.
- "Unmeasured" and "unconfirmed" are valid answers (CLAUDE.md). No impact number without shown work.
- Prove each instrument can fail before trusting it (CLAUDE.md, "prove the instrument can produce a
  red one"): the load test runs once against a deliberately broken build or a throttled endpoint and
  must report the failure.
- Run against the local stack or a Supabase branch. **Never against production.**

## Questions to answer

1. **Every poll and subscription in the app today.** For each `refetchInterval` (about 20 sites today),
   each `useRealtime*` hook (7; say which use `postgres_changes` and which use broadcast) and each broadcast topic: the screen, the
   interval, what it fetches, and the cost per open screen per hour. One table.
2. **The hot paths, measured.** Requests and query time for: opening a trip, opening the cup board,
   scoring one hole, finalizing a game, opening a game panel. Note which RLS helpers each path calls
   and run `EXPLAIN ANALYZE` on the slowest three queries with realistic row counts (seed enough to
   look like 50 trips, 2,000 users, 20,000 games).
3. **Load test.** A k6 (or similar) script, committed under `scripts/load/`, for N people scoring and
   M people watching one board. Report where it breaks: request rate, Postgres connections, Realtime
   connections and messages against the current Supabase plan's limits (name the plan and its limits).
4. **Realtime for the redesign.** Recommend one design for: a live game, a live board, a crew page and
   Home. Say for each: broadcast or `postgres_changes`, the topic, what the payload carries (a signal,
   never data, CLAUDE.md #20), and the fallback poll. Account for #19 and #20 (keep the backstop polls).
5. **Home.** The redesign's Home gathers live games, series, cups, trips and leagues across every crew
   a person is in. Estimate the cost of building it per open with today's queries, and recommend
   whether it needs a stored per-user "home items" index (plan section 2) or can be one query.
6. **RLS at scale.** List the helpers that run per row on large tables (`is_trip_member` and kin) and
   say which will need crew-aware versions, and what index each needs.
7. **Connections and functions.** Confirm everything goes through the pooler; list any route with a
   long `maxDuration` or work done after the response.

## STOP and report before writing the fix list if

- any measurement needs production, a paid plan change, or a schema change to take;
- the current plan's Realtime or connection limits are below the target at a size BBMI could reach.

## DO NOT

- Change application code, schema, RLS or config. The load script and its seed are the only new files
  besides the report, and the seed never runs against production.
- Add a dependency to `package.json` (run tools with `npx`).
- Recommend removing a backstop poll (#19, #20).
- Write the fix list as code. It is a list: problem, evidence, proposed change, which spec it belongs to.

## Done when

`SCALE_AUDIT.md` has: the poll/subscription table, the measured hot paths, load-test results with the
breaking point, the Realtime recommendation, the Home recommendation, the RLS list, "Docs that are
wrong", and a fix list tagged by phase (1 foundation, 2 game loop, 4 Home, 5 competitions, 6 trips).
