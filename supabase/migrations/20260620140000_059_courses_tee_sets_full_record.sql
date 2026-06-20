-- 059 — courses.tee_sets: the FULL per-tee record (Golf Course API v1)
--
-- tee_sets is jsonb, so the shape change is application-level (the Zod gate in
-- courses.create + the provider mapping). This migration is the SCHEMA-side
-- record of the new contract — no DDL beyond the documenting COMMENT, no data
-- DML (per CLAUDE.md: migrations are production-safe; mock-data cleanup is
-- out-of-band). Idempotent.
--
-- OLD shape (Slice C):   [{ name, yards: (int|null)[] }]
-- NEW shape (this rev):  [{ name, courseRating, slopeRating, bogeyRating,
--                           yards: (int|null)[] }]
--   - The three ratings are nullable: golfcourseapi supplies them per tee;
--     manual entry leaves them null (par + stroke index alone still score).
--   - par is course-level (courses.par) and the stroke index lives in
--     courses.handicap_index — NOT per tee. Only yardage + ratings vary by tee.
--   - Storing every tee's full per-hole yardage is the foundation the future
--     moving-tees feature reads (render any tee at any hole without a re-fetch
--     against the API daily cap). This rev STORES + DISPLAYS only — no movement.

COMMENT ON COLUMN public.courses.tee_sets IS
  'Per-tee records: [{ name, courseRating, slopeRating, bogeyRating, yards: (int|null)[] }]. '
  'Ratings nullable (golfcourseapi supplies them; manual entry leaves null). par is '
  'course-level (courses.par); stroke index is courses.handicap_index — only yardage + '
  'ratings vary by tee. Full per-tee yardage is the moving-tees storage foundation.';

-- Provenance marker now names the live provider (was 'golfapi'). No data DML:
-- 0 rows carried the old value, and there is no CHECK constraint to alter.
COMMENT ON COLUMN public.courses.source IS
  'Provenance: ''manual'' (hand-entered) | ''golfcourseapi'' (imported from golfcourseapi.com).';
