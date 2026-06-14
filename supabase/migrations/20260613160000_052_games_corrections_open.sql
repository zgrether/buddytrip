-- 052 — games.corrections_open (Slice D Run/Post: the posted→correcting sub-state)
--
-- The run state model is Open → Posted/Locked ⇄ Correcting. It maps onto the
-- existing `status` plus this one boolean — NOT a new status (audit Stage 2):
--
--   OPEN        status pending|active                    (never posted)
--   POSTED      status complete, corrections_open=false  (scores frozen, on board)
--   CORRECTING  status complete, corrections_open=true   (result still on the
--                                                          board; score entry
--                                                          re-opened for edits)
--
-- "Posting" publishes the current standing (re-runnable) — it is NOT a permanent
-- finalize. Re-post just re-commits and clears corrections_open. Score entry is
-- gated when status='complete' AND NOT corrections_open (server-enforced in the
-- scores router); a posted game stays fully VISIBLE — only editing is closed.
-- Idempotent.

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS corrections_open boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.games.corrections_open IS
  'Run state sub-flag: with status=complete, true means the posted game is in '
  'score-correction mode (entry re-opened). Cleared on (re-)post. A posted game '
  'is complete + corrections_open=false.';
