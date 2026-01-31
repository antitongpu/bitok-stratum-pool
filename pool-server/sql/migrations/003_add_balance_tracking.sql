/*
  # Add Balance Tracking for Miners

  1. Changes to miners table
    - Add `balance` column (BIGINT) - accumulated unpaid earnings in satoshis
    - Add `immature` column (BIGINT) - earnings from unconfirmed blocks in satoshis

  2. Purpose
    - Track accumulated earnings for each miner
    - Miners below payment threshold keep their balance for next round
    - Immature shows earnings from blocks not yet confirmed
    - No earnings are lost for small miners
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'miners' AND column_name = 'balance'
  ) THEN
    ALTER TABLE miners ADD COLUMN balance BIGINT DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'miners' AND column_name = 'immature'
  ) THEN
    ALTER TABLE miners ADD COLUMN immature BIGINT DEFAULT 0;
  END IF;
END $$;

UPDATE miners SET balance = 0 WHERE balance IS NULL;
UPDATE miners SET immature = 0 WHERE immature IS NULL;
