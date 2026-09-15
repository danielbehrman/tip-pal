-- Adds dose_date as the real calendar-date identity for dose_log 'day'
-- session rows, replacing the "parse completed_at, guess the local
-- timezone" approach used throughout this codebase today. Nullable for
-- now — existing rows need a one-time backfill (scripts/backfill-dose-date.js)
-- before this can be made NOT NULL and given a uniqueness constraint (see
-- the follow-up migration, 20260915_dose_log_dose_date_constraint.sql).
--
-- ramp_finalized tracks whether nightly finalization has already applied
-- Reaction Ramp advancement for this specific day, so re-running
-- finalization (safe and idempotent for treatment position, which is a
-- full replay) doesn't double-advance a ramp step, which is NOT a replay —
-- it's incremental state. Defaults to true so every row that already
-- exists today (all of them processed under the old Complete Day model,
-- which always ran ramp advancement synchronously) is correctly treated
-- as already-finalized. New rows override this to false at insert time —
-- see Task 6.
--
-- Both columns are additive with safe defaults/nullability — no currently
-- deployed code reads or writes either one, so this is safe to apply
-- anytime regardless of when the rest of this plan ships.
ALTER TABLE dose_log
  ADD COLUMN IF NOT EXISTS dose_date date,
  ADD COLUMN IF NOT EXISTS ramp_finalized boolean NOT NULL DEFAULT true;
