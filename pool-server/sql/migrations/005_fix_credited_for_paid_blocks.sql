/*
  # Fix credited column for already-paid blocks

  1. Purpose
    - Mark all blocks that were already paid (at 12 confirmations) as credited
    - Prevents double payment when blocks reach 121 confirmations
    - This is a data fix for blocks that were paid before the credited tracking was added

  2. Changes
    - Sets credited = true for all blocks where paid = true
*/

UPDATE blocks SET credited = true WHERE paid = true AND (credited = false OR credited IS NULL);
