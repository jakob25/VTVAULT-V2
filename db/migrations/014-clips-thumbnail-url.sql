-- Optional thumbnail cache for clips (YouTube + Twitch).
-- Run in Supabase SQL Editor if the column does not exist yet.

ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

COMMENT ON COLUMN public.clips.thumbnail_url IS 'Cached preview image (YouTube i.ytimg or Twitch og:image)';
