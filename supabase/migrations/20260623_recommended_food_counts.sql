-- Phase 3 F3: weekly tally counter for recommended foods.

ALTER TABLE dose_state
  ADD COLUMN IF NOT EXISTS recommended_food_counts jsonb NOT NULL DEFAULT '{}'::jsonb;
