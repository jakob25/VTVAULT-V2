-- Fix clips.profile_id so clip submit can link to VTuber stubs (text ids like vt_imoutopup_xxxxxx).
-- Root cause: clips_profile_id_fkey did not reference vtubers(id), so every profile_id write failed
-- and the app fell back to name-only clips.
--
-- Run this in the Supabase SQL Editor (staging first, then production).

-- 1) Drop the broken constraint
ALTER TABLE public.clips DROP CONSTRAINT IF EXISTS clips_profile_id_fkey;

-- 2) Ensure profile_id is text (VTuber primary keys are text, not uuid)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clips'
      AND column_name = 'profile_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.clips
      ALTER COLUMN profile_id TYPE text USING profile_id::text;
  END IF;
END $$;

-- 3) Clear any orphan values that cannot reference vtubers
UPDATE public.clips c
SET profile_id = NULL
WHERE c.profile_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.vtubers v WHERE v.id = c.profile_id
  );

-- 4) Point FK at the real VTuber table
ALTER TABLE public.clips
  ADD CONSTRAINT clips_profile_id_fkey
  FOREIGN KEY (profile_id)
  REFERENCES public.vtubers(id)
  ON DELETE SET NULL;

-- 5) Backfill: attach orphan clips to existing VTubers by name/handle
UPDATE public.clips c
SET profile_id = v.id
FROM public.vtubers v
WHERE c.profile_id IS NULL
  AND c.vtuber_name IS NOT NULL
  AND (
    lower(v.name) = lower(c.vtuber_name)
    OR lower(v.handle) = lower(c.vtuber_name)
    OR lower(regexp_replace(v.name, '[^a-z0-9]', '', 'g'))
       = lower(regexp_replace(c.vtuber_name, '[^a-z0-9]', '', 'g'))
  );

-- Optional check after running:
-- SELECT id, title, vtuber_name, profile_id FROM public.clips ORDER BY created_at DESC LIMIT 10;
