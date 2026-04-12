-- Migration 043: add notes column to idea_lodging_options
-- Stores free-text thoughts about a property, e.g. "great pool, tons of space"

ALTER TABLE idea_lodging_options ADD COLUMN IF NOT EXISTS notes text;
