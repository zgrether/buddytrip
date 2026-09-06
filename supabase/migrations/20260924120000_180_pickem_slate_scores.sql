-- 180 — the contest's own score, and its lifecycle status.
--
-- ══ Why now ═════════════════════════════════════════════════════════════════
--
-- #1321 shipped the DISPLAY for a pick'em score — a two-row slot beside the
-- matchup, guarded so that absent renders as nothing rather than as 0–0. It
-- shipped with nothing able to write it: `pickem_slate_games` has no score
-- column, and the router's select is an explicit column list, so there was not
-- even a back door through which a hand-set value could reach the client.
--
-- These two columns are what make that slot real. Entry is MANUAL (the runner
-- types the final alongside the outcome they are already recording); a future
-- scheduled fetch is a convenience on top, not a prerequisite.
--
-- ══ Why `status` lands in the same migration ═══════════════════════════════
--
-- `kickoff` is free TEXT (#1137) — "Fri Sep 4, 6:10p" — so nothing in this
-- schema can answer "has this game finished?". A stored status is the only
-- thing that can, and it is exactly what a scheduled fetch's cost gate would
-- read: poll while any locked slate holds a game that is not `final`, stop on
-- its own when the last one ends, with nobody having to come back.
--
-- Adding it now costs one column. Adding it later costs a second migration and
-- a second manual production push.
--
-- NOTHING WRITES IT YET, and that is stated rather than left to be discovered.
-- It is a column ahead of its writer, added deliberately.
--
-- ══ Two integers, not one string ═══════════════════════════════════════════
--
-- The shipped display takes `awayScore` and `homeScore` separately
-- (`PickemBoard.tsx`), and a single "17-24" text field would have to be parsed
-- back apart by every reader — with a half-typed value ("17-") parsing to
-- something wrong rather than to nothing. Two nullable integers cannot be
-- half-parsed.
--
-- ══ Deliberately NOT constrained: both-or-neither ══════════════════════════
--
-- The obvious invariant is `(away_score IS NULL) = (home_score IS NULL)` —
-- half a score is not a score, which is exactly what the display already
-- enforces by rendering nothing unless both are present.
--
-- It is NOT enforced here, because manual entry produces the half state
-- legitimately: a runner types the away team's score, and until they reach the
-- second field the row genuinely holds one number. A CHECK would refuse the
-- first keystroke of every score ever entered. The rule belongs where it
-- already is — at the read, where "one number" renders as no score at all.
--
-- ══ What IS constrained ════════════════════════════════════════════════════
--
-- A score cannot be negative, and a status must be one of three words. Both
-- reject something real: `-1` and a typo respectively. `status` is the app's
-- vocabulary rather than any provider's — a fetch that speaks pre/in/post maps
-- into it at the boundary, so the column does not inherit an external API's
-- naming.

ALTER TABLE public.pickem_slate_games
  ADD COLUMN IF NOT EXISTS away_score integer,
  ADD COLUMN IF NOT EXISTS home_score integer,
  ADD COLUMN IF NOT EXISTS status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pickem_slate_games_scores_nonneg'
  ) THEN
    ALTER TABLE public.pickem_slate_games
      ADD CONSTRAINT pickem_slate_games_scores_nonneg
      CHECK (
        (away_score IS NULL OR away_score >= 0)
        AND (home_score IS NULL OR home_score >= 0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pickem_slate_games_status_known'
  ) THEN
    ALTER TABLE public.pickem_slate_games
      ADD CONSTRAINT pickem_slate_games_status_known
      CHECK (status IS NULL OR status IN ('scheduled', 'in_progress', 'final'));
  END IF;
END $$;

COMMENT ON COLUMN public.pickem_slate_games.away_score IS
  'The visiting side''s final/current score. NULL means UNKNOWN, never zero — a scoreless game is 0, and the display renders nothing at all when either side is null. Entered by hand on the results row; a scheduled fetch may write it later. NEVER interpreted: cover against the spread stays the runner''s call, because the spread is hand-entered too and deriving one manual input from two others turns a judgement into an automatic decision.';

COMMENT ON COLUMN public.pickem_slate_games.home_score IS
  'The home side''s score. See away_score — same rules, and half a score is not a score (enforced at the read, not here, so manual entry can pass through the one-number state).';

COMMENT ON COLUMN public.pickem_slate_games.status IS
  'Where the contest is in its own lifecycle: scheduled | in_progress | final. NOTHING WRITES THIS YET (migration 180) — it exists because `kickoff` is free text (#1137), so nothing else in this schema can say a game has ended, and a scheduled fetch''s cost gate needs exactly that: keep polling while a locked slate holds a non-final game, stop on its own when the last ends. The app''s own vocabulary, not a provider''s; a fetch maps into it at the boundary. DISTINCT from `result`, which is the runner''s judgement about who covered — a game can be `final` with no result recorded, and that combination is the normal state of a slate mid-weekend.';
