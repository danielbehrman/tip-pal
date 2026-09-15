-- Two functions backing the auto-save/nightly-finalization redesign's
-- concurrency safety. supabase-js's .upsert() cannot express a JSONB-merge
-- SET clause on conflict (PostgREST upserts always replace the named
-- columns outright) — these are real Postgres functions, called via
-- .rpc(), for the cases that need one.
--
-- Both derive family_id server-side from the authenticated session, never
-- from a caller-supplied parameter — matching every other write path in
-- this codebase (see getFamilyId() in lib/supabase.ts). A client can only
-- ever write its own family's row.
--
-- Requires dose_log_family_dose_date_day_idx (the partial unique index
-- from 20260915_dose_log_dose_date_constraint.sql) to actually succeed at
-- runtime — safe to create this function before that index exists, but it
-- will error on first real call until it does.

-- p_schedule_snapshot is written only on first-insert, never on the
-- DO UPDATE branch — DayEditor.tsx and classifyDoseLogDay both fall back to
-- *today's current* schedule when a row's schedule_snapshot is null
-- (`entry.scheduleSnapshot ?? fallbackSchedule`), so a row created by this
-- function without one would silently show the wrong historical doses for
-- any day logged before a later schedule re-parse. Must be captured at the
-- moment this calendar day first gets any data, and never overwritten by a
-- later re-parse mid-day, matching how the old saveDoseLog (single insert
-- per day, at the old Complete Day's tap) always set it exactly once.
CREATE OR REPLACE FUNCTION upsert_checked_food(
  p_dose_date date,
  p_key text,
  p_value boolean,
  p_week integer,
  p_day integer,
  p_schedule_snapshot jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id FROM profiles WHERE id = auth.uid();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'No family found for authenticated user';
  END IF;

  INSERT INTO dose_log (family_id, dose_date, week, day, session, checked_foods, completed_at, is_skipped, ramp_finalized, schedule_snapshot)
  VALUES (v_family_id, p_dose_date, p_week, p_day, 'day', jsonb_build_object(p_key, p_value), now(), false, false, p_schedule_snapshot)
  ON CONFLICT (family_id, dose_date) WHERE session = 'day'
  DO UPDATE SET
    checked_foods = dose_log.checked_foods || jsonb_build_object(p_key, p_value),
    completed_at = now();
END;
$$;

-- Nightly finalization's gap-fill: ensure a row exists for a calendar day
-- with zero taps, without ever overwriting a row that already has real
-- checked_foods from live writes. Plain "insert if absent" — no merge
-- needed, so DO NOTHING is correct here (unlike upsert_checked_food above).
-- Same schedule_snapshot rule as above: set only on the insert this
-- function performs, never touched again after.
CREATE OR REPLACE FUNCTION ensure_dose_log_day(
  p_dose_date date,
  p_week integer,
  p_day integer,
  p_schedule_snapshot jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id FROM profiles WHERE id = auth.uid();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'No family found for authenticated user';
  END IF;

  INSERT INTO dose_log (family_id, dose_date, week, day, session, checked_foods, completed_at, is_skipped, ramp_finalized, schedule_snapshot)
  VALUES (v_family_id, p_dose_date, p_week, p_day, 'day', '{}'::jsonb, now(), true, false, p_schedule_snapshot)
  ON CONFLICT (family_id, dose_date) WHERE session = 'day'
  DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_checked_food(date, text, boolean, integer, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_dose_log_day(date, integer, integer, jsonb) TO authenticated;
