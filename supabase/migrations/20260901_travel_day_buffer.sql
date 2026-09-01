-- Phase 4: Travel Day Buffer. A family that flies to appointments loses one
-- additional non-dosing day before the appointment; the buffer calculation
-- accounts for it when this flag is set. Defaults to false so every existing
-- family's buffer math is unchanged until they explicitly opt in via Settings.
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS flies_to_appointments BOOLEAN NOT NULL DEFAULT false;
