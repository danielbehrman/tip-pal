-- Phase 4: manual mid-cycle reaction ramp. Stored as JSONB on families —
-- one active ramp per household at a time, replaced wholesale on Edit,
-- read alongside the rest of the family row. previous_ramps is an append-only
-- history log, same pattern as previous_cycles (20260625_new_cycle.sql).
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS reaction_ramp JSONB NOT NULL DEFAULT '{"active": false}'::jsonb,
  ADD COLUMN IF NOT EXISTS previous_ramps JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE dose_log
  ADD COLUMN IF NOT EXISTS ramp_active BOOLEAN NOT NULL DEFAULT false;
