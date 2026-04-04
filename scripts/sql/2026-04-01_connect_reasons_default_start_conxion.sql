-- Migration: add "Start a ConXion" default connect reason
--
-- 1. Extend context_check to allow 'general' (shown in all contexts)
ALTER TABLE public.connect_reasons
  DROP CONSTRAINT IF EXISTS connect_reasons_context_check;

ALTER TABLE public.connect_reasons
  ADD CONSTRAINT connect_reasons_context_check CHECK (
    context = ANY (ARRAY['member'::text, 'trip'::text, 'general'::text])
  );

-- 2. Extend role_check to allow 'General' (universal / not role-specific)
ALTER TABLE public.connect_reasons
  DROP CONSTRAINT IF EXISTS connect_reasons_role_check;

ALTER TABLE public.connect_reasons
  ADD CONSTRAINT connect_reasons_role_check CHECK (
    role = ANY (ARRAY[
      'General'::text,
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

-- 3. Insert the default "Start a ConXion" reason
INSERT INTO public.connect_reasons (id, label, role, active, sort_order, context)
VALUES ('default_start_conxion', 'Start a ConXion', 'General', true, 0, 'general')
ON CONFLICT (id) DO UPDATE
  SET label      = excluded.label,
      role       = excluded.role,
      active     = excluded.active,
      sort_order = excluded.sort_order,
      context    = excluded.context;
