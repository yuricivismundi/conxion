-- Migration: split "Social Dancer / Student" into "Social Dancer" and "Student"
--
-- 1. Update profiles.roles  — replace the combined value with "Social Dancer"
--    (existing users who had the combined role become "Social Dancer"; they can
--    re-select "Student" from their profile edit page if applicable)
UPDATE public.profiles
SET roles = array_replace(roles, 'Social Dancer / Student', 'Social Dancer')
WHERE 'Social Dancer / Student' = ANY(roles);

-- Also handle the lowercase variant stored by some onboarding paths
UPDATE public.profiles
SET roles = array_replace(roles, 'Social dancer / Student', 'Social Dancer')
WHERE 'Social dancer / Student' = ANY(roles);

-- 2. Same cleanup on demo_profiles
UPDATE public.demo_profiles
SET roles = array_replace(roles, 'Social Dancer / Student', 'Social Dancer')
WHERE 'Social Dancer / Student' = ANY(roles);

UPDATE public.demo_profiles
SET roles = array_replace(roles, 'Social dancer / Student', 'Social Dancer')
WHERE 'Social dancer / Student' = ANY(roles);

-- 3. Clean up connect_reasons rows BEFORE adding the new constraint
UPDATE public.connect_reasons
SET role = 'Social Dancer'
WHERE role IN ('Social Dancer / Student', 'Social dancer / Student');

-- 4. Update connect_reasons CHECK constraint to allow the two new values
ALTER TABLE public.connect_reasons
  DROP CONSTRAINT IF EXISTS connect_reasons_role_check;

ALTER TABLE public.connect_reasons
  ADD CONSTRAINT connect_reasons_role_check CHECK (
    role = ANY (ARRAY[
      'Social Dancer'::text,
      'Student'::text,
      'Organizer'::text,
      'Studio Owner'::text,
      'Promoter'::text,
      'DJ'::text,
      'Artist'::text,
      'Teacher'::text
    ])
  );
