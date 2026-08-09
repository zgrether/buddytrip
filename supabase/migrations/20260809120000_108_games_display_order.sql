-- 108 — games.display_order: the owner-set order games appear in on the board.
--
-- ── What this is for ─────────────────────────────────────────────────────────
-- The competition leaderboard has always ordered games by `created_at ASC`
-- (`competitionLeaderboard.ts`), so the order was whatever order they happened to
-- be created in and could not be changed. This adds an explicit order the owner
-- (or a co-admin — the same `canEdit` that already governs adding and deleting
-- games on that surface) can set by dragging.
--
-- ── ONE value per game, GLOBAL — not per section ─────────────────────────────
-- The board splits games across five sections by lifecycle state (completed /
-- on-tap / ready / preparing / skeleton), and EVERY section sorts by this one
-- column. That is the point rather than an implementation detail: a game that
-- changes state alone keeps its number, so when its neighbour catches up they are
-- still in the order the owner set. Arrival order never matters.
--
-- ── Scope: per COMPETITION ───────────────────────────────────────────────────
-- The leaderboard reads `.eq("competition_id", …)`, so a competition is the only
-- scope in which "which game comes first" means anything. The backfill partitions
-- accordingly. Standalone games (no competition) have no board to be ordered on;
-- they partition on a NULL competition_id and are simply never read this way.
--
-- ── NULLABLE, deliberately ───────────────────────────────────────────────────
-- No NOT NULL and no default. A row this backfill somehow misses, or one inserted
-- by a path that forgets to set it, must sort PREDICTABLY rather than disappear —
-- readers sort by `(display_order, created_at)` with nulls last, so an unordered
-- game lands at the bottom in creation order instead of vanishing from the board.
-- A NOT NULL column would have to invent a value at insert time, and the value it
-- would invent (0, or a sequence) is exactly the one that reorders the board
-- silently. Failing visibly beats failing invisibly.
--
-- A DB default cannot express what a new game actually needs — "the highest number
-- in use WITHIN MY COMPETITION, plus one" — so that belongs to `games.create`, in
-- the application, not here.
--
-- ── Not in the config hash ───────────────────────────────────────────────────
-- `display_order` is deliberately excluded from `games.configHash` (CLAUDE.md #16)
-- and is classified in `configHash.coverage.test.ts`'s NOT_HASHED list, alongside
-- `scheduled_at`, for the same reason: it is board presentation, not game config.
-- The hash is polled per-GAME by open game surfaces to detect config drift, and
-- nothing a game surface renders or computes depends on where the game sits on the
-- board. Hashing it would move the fingerprint on every reorder and make every
-- open game view on every device re-pull its whole config for a change that does
-- not affect it. Propagation is the leaderboard's job — the reorder mutation
-- invalidates `competitions.leaderboard` AND `competitions.faceBootstrap` (#10).
--
-- ── Replay + idempotence ─────────────────────────────────────────────────────
-- Additive, idempotent, and reproducible from an empty database: `IF NOT EXISTS`
-- on the column, and the backfill is guarded on `display_order IS NULL` so a
-- re-run is a no-op. It keys on `created_at` — a stable column every row has —
-- never on environment-specific ids, which is what made the historical `044`
-- unreplayable (#636).
--
-- No index. `games` is small (the whole production table is a few hundred rows
-- across all trips) and every read is already filtered to one competition, so a
-- sort over that handful is free; an index here would be maintenance cost with no
-- measured benefit. Revisit if a single competition ever carries enough games for
-- the sort to show up.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS display_order integer;

COMMENT ON COLUMN public.games.display_order IS
  'Owner-set board order, scoped per competition. One global value used by EVERY '
  'leaderboard section, so a game keeps its place as it moves Ready -> Live -> '
  'Completed. NULL sorts last (by created_at) rather than vanishing. Set to '
  'max+1 within the competition on create. NOT part of games.configHash.';

-- Seed from the order the board already showed, so nothing visibly moves on
-- deploy: creation order within each competition.
UPDATE public.games AS g
SET display_order = seeded.rn
FROM (
  SELECT id,
         row_number() OVER (PARTITION BY competition_id ORDER BY created_at, id) AS rn
  FROM public.games
) AS seeded
WHERE g.id = seeded.id
  AND g.display_order IS NULL;
