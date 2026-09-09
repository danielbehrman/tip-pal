-- Retires floor_week/floor_day (added 20260621_navigation_floor.sql). The
-- floor and cycle_start_date were only ever supposed to move together (on
-- an actual New Food Cycle reset or onboarding) — keeping them as two
-- separately-written fields is exactly the redundancy that caused four
-- distinct bugs across dogfooding rounds 1-5 (two things that must always
-- agree, written in different places, occasionally forgotten in one).
-- The editable/backfillable boundary is now a direct date comparison
-- against cycle_start_date, which already represents the same boundary
-- this migration's original comment describes ("the actual entered
-- starting position") without a second field to keep in sync.

ALTER TABLE dose_state
  DROP COLUMN IF EXISTS floor_week,
  DROP COLUMN IF EXISTS floor_day;
