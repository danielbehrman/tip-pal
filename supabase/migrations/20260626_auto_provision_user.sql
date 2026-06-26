-- Auto-create a families row and profiles row when a new auth user is created.
-- Without this, getFamilyId() throws "Profile not found" on every new user's first save.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_family_id uuid;
BEGIN
  new_family_id := gen_random_uuid();
  INSERT INTO public.families (id, name, created_at, previous_cycles)
  VALUES (new_family_id, '', now(), '[]'::jsonb);
  INSERT INTO public.profiles (id, family_id, display_name, created_at)
  VALUES (NEW.id, new_family_id, '', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
