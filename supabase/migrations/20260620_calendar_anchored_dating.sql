-- Phase 3 F0.1: Calendar-Anchored Day Dating

ALTER TABLE dose_state
  ADD COLUMN IF NOT EXISTS cycle_start_date date,
  ADD COLUMN IF NOT EXISTS skip_count integer NOT NULL DEFAULT 0;

-- One-time backfill for any existing rows (production: single family, already
-- mid-protocol). Backdates cycle_start_date from the currently stored
-- current_week/current_day so today maps to the account's real position.
--
-- NOTE: when this ran against production, CURRENT_DATE (UTC) was used for
-- the backfill below. For any family whose local day differs from UTC at
-- the moment this runs, compute their actual local date from
-- profiles.reminder_timezone first and substitute a literal date instead of
-- trusting CURRENT_DATE — see the production note in plans/PHASE-3-F0.1.md
-- Task 1 for why.
UPDATE dose_state
SET cycle_start_date = (
  CURRENT_DATE - (((current_week - 1) * 7 + (current_day - 1)))
)
WHERE cycle_start_date IS NULL;

ALTER TABLE dose_state
  ALTER COLUMN cycle_start_date SET NOT NULL;
