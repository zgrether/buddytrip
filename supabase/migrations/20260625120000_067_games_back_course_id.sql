-- W-9HOLE-01: retained two-nines composition.
--
-- A 9-hole course can't stand alone — it's slotted as the FRONT nine and a BACK
-- nine (another 9-hole course) is composed in to make a retained two-nines 18.
-- `games.course_id` stays the FRONT ref (unchanged for the 99% 18-hole case);
-- `back_course_id` is the BACK ref, set only for a composed two-nines game. The
-- composed 18's par/index/yards are snapshotted into `scorecard_schema` as usual
-- (present-as-18); the two refs are RETAINED so the back can swap day-of without
-- touching the front (setBackNine clears holes 10-18 + recomposes, front intact).
-- NULL back_course_id = a normal single-course game (18-hole, or a 9-hole front
-- still awaiting its back nine — "needs a back nine", derivable from the schema's
-- 9-unit count).

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS back_course_id text REFERENCES public.courses(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.games.back_course_id IS
  'The BACK nine of a retained two-nines 18 (W-9HOLE-01). NULL for a normal '
  'single-course game; set when a 9-hole front (course_id) has a 9-hole back '
  'composed in. The composed par/index lives in scorecard_schema; this retains '
  'the back ref so it can swap independently of the front.';
