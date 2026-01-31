/*
  # Add credited column to blocks table

  1. Changes to blocks table
    - Add `credited` column (BOOLEAN) - tracks if block earnings have been credited to miner balances

  2. Purpose
    - Separates "credited to balance" from "paid out"
    - Allows tracking when block rewards are added to miner balances
    - Prevents double-crediting of block rewards
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'blocks' AND column_name = 'credited'
  ) THEN
    ALTER TABLE blocks ADD COLUMN credited BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

UPDATE blocks SET credited = paid WHERE credited IS NULL;
