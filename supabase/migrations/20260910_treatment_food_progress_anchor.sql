-- Part of the Recompute Anchor Fix (Trailing Edit Redesign follow-up, C1).
-- recomputeFoodProgressFromHistory needs to know each food's true starting
-- position to replay its dose_log history correctly — it can't assume every
-- food starts at Week 1 Day 1, since the position stepper and Settings'
-- per-food corrector can both declare a different starting point. These
-- columns are that declaration: written only by seedFoodProgress and
-- saveFoodPosition, never by routine advancement or Trailing Edit.
--
-- Additive with defaults — safe to apply regardless of deploy timing,
-- unlike the floor_week/floor_day DROP COLUMN migration this follows.

ALTER TABLE treatment_food_progress
  ADD COLUMN IF NOT EXISTS anchor_week integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS anchor_day integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS anchor_date date NOT NULL DEFAULT CURRENT_DATE;
