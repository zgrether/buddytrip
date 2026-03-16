-- Add source column to ideas table to distinguish manual vs AI-suggested ideas
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
COMMENT ON COLUMN ideas.source IS 'Origin of the idea: manual (user-entered) or ai (Claude-suggested)';
