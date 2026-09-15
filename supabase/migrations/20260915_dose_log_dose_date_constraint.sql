-- Follow-up to 20260914_dose_log_dose_date.sql. Only safe to apply after
-- scripts/backfill-dose-date.js has been run with --apply against
-- production and every row confirmed to have a correct dose_date — see
-- that script's own header and this plan's Task 2 Step 5 for the required
-- verification. Applying this before the backfill completes fails
-- outright (NOT NULL against rows still null); applying it after a rushed
-- or wrong backfill would enforce uniqueness against corrupted dates.
--
-- The partial index (WHERE session = 'day') is what Task 6's
-- upsert_checked_food/ensure_dose_log_day functions conflict on — it is
-- the mechanism that makes "exactly one row per family per real calendar
-- day" an enforced database invariant, not just an application convention.
ALTER TABLE dose_log
  ALTER COLUMN dose_date SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dose_log_family_dose_date_day_idx
  ON dose_log (family_id, dose_date)
  WHERE session = 'day';
