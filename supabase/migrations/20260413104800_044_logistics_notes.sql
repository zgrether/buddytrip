-- Migration 044: add notes column to logistics_items
ALTER TABLE logistics_items ADD COLUMN IF NOT EXISTS notes text;
