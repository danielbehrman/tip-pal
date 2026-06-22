-- Phase 3 F0.1 follow-up: fix AC #7 (undated mid-protocol history).
--
-- Position 0 in the cycle_start_date formula always corresponds to "Week 1,
-- Day 1" by construction, even for a mid-protocol setup where cycle_start_date
-- is backdated to make TODAY map to the entered week/day. That backdated
-- date is not a date the family actually used the app, but without a
-- separate floor, Day-/Week- navigation could browse back to it and show a
-- normal dated header instead of stopping at the real starting position.
--
-- floor_week/floor_day store the actual entered starting position (set at
-- onboarding, Settings override, and future New Food Cycle) and bound
-- Day-/Week- navigation so it can't go below where the family actually
-- started. Default 1,1 preserves current unrestricted behavior for any
-- family that started at Week 1, Day 1 (including the existing production
-- family, migrated here with no real record of a mid-protocol start).

ALTER TABLE dose_state
  ADD COLUMN IF NOT EXISTS floor_week integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS floor_day integer NOT NULL DEFAULT 1;
