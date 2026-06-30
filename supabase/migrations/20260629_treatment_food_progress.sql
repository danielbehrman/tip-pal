CREATE TABLE IF NOT EXISTS public.treatment_food_progress (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id         uuid        NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  food_name         text        NOT NULL,
  week              integer     NOT NULL DEFAULT 1,
  day               integer     NOT NULL DEFAULT 1,
  completed_days    integer     NOT NULL DEFAULT 0,
  last_completed_at timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE(family_id, food_name)
);

ALTER TABLE public.treatment_food_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family_can_access_own_food_progress"
  ON public.treatment_food_progress
  FOR ALL
  USING (
    family_id IN (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    family_id IN (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_treatment_food_progress_family_id
  ON public.treatment_food_progress(family_id);
