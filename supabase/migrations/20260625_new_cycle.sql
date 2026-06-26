ALTER TABLE families
  ADD COLUMN IF NOT EXISTS previous_cycles JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS visit_number TEXT;
