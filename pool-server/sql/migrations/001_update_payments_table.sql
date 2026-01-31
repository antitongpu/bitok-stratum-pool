-- Migration: Update payments table with new fields
-- Date: 2026-01-21
-- Description: Adds error_message and blocks_included columns for better payment tracking

-- Add error_message column for logging payment failures
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add blocks_included column to track which blocks contributed to payout
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS blocks_included INTEGER[];

-- Create index for faster status queries
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Create index for tx_hash lookups
CREATE INDEX IF NOT EXISTS idx_payments_txhash ON payments(tx_hash);
