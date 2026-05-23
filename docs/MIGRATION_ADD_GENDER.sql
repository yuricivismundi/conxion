-- Migration: Add user gender to profiles
-- Run this in Supabase SQL editor (staging first, then production)
-- Safe to run multiple times (IF NOT EXISTS)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text;

-- Optional CHECK constraint to limit accepted values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_gender_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_gender_check
      CHECK (gender IS NULL OR gender IN ('woman', 'man', 'nonbinary', 'prefer_not_to_say'));
  END IF;
END $$;

-- Default existing rows to NULL (they'll appear as 'prefer_not_to_say' in the UI)

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'gender';
