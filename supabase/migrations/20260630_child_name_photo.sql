-- Add child_name and child_photo_url to families table
ALTER TABLE families ADD COLUMN IF NOT EXISTS child_name TEXT;
ALTER TABLE families ADD COLUMN IF NOT EXISTS child_photo_url TEXT;

-- Seed child_name from existing name for all existing rows
UPDATE families SET child_name = name WHERE child_name IS NULL AND name IS NOT NULL;

-- Create public avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload to avatars bucket
CREATE POLICY "Authenticated can upload avatars"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Authenticated can update avatars"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');

-- Public reads are handled automatically by the public bucket setting
