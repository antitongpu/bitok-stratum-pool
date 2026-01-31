-- Migration: Add paid column to blocks table
-- Date: 2026-01-21
-- Description: Adds paid column to track which blocks have been paid out

ALTER TABLE blocks
ADD COLUMN IF NOT EXISTS paid BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_blocks_paid ON blocks(paid);
CREATE INDEX IF NOT EXISTS idx_blocks_confirmed_paid ON blocks(confirmed, paid);
