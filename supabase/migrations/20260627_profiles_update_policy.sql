-- Allow users to update their own profile row.
-- Without this, saveTimezone() silently failed (RLS blocked UPDATE, only SELECT existed).
CREATE POLICY "users_can_update_own_profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
