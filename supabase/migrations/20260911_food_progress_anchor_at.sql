-- Follow-up to 20260910_treatment_food_progress_anchor.sql (final cross-cutting
-- review finding I2). anchor_date (date-only) can't disambiguate a same-day
-- ordering question: whether a dose_log entry for a given calendar day was
-- created before or after that day's anchor was declared (e.g. a Settings
-- correction made after today's dose was already checked). anchor_at records
-- the precise moment instead, compared directly against dose_log's
-- completed_at timestamps.
--
-- Additive with a safe default (now() at apply time behaves exactly like the
-- "current position, right now" anchor already in use) — anchor_date has
-- never been read by any deployed code (this whole anchor mechanism has not
-- shipped yet), so it's dropped here rather than carried forward.

ALTER TABLE treatment_food_progress
  ADD COLUMN IF NOT EXISTS anchor_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE treatment_food_progress
  DROP COLUMN IF EXISTS anchor_date;
