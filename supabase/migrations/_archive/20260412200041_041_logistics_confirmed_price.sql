-- Migration 041: add is_confirmed and total_price to logistics_items
-- is_confirmed mirrors the schedule_items pattern for lodging comparison workflow.
-- total_price stored as text to avoid locale/precision issues at entry time.

ALTER TABLE logistics_items
  ADD COLUMN IF NOT EXISTS is_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_price   text;
