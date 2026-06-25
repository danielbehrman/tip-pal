-- Phase 3: user-defined food groups for the morning section.
-- Stored as JSONB on families — one row per family, small dataset, no separate table needed.
-- Each group: { id, name, foodNames: string[], sortOrder: number }

ALTER TABLE families
  ADD COLUMN IF NOT EXISTS food_groups JSONB NOT NULL DEFAULT '[]'::jsonb;
