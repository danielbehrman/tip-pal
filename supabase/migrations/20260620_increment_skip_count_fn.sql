-- Phase 3 F0.1: atomic increment for Skip Day, avoids a read-then-write race
-- on dose_state.skip_count.

CREATE OR REPLACE FUNCTION increment_skip_count(p_family_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE dose_state SET skip_count = skip_count + 1, updated_at = now()
  WHERE family_id = p_family_id;
$$;
