CREATE TABLE IF NOT EXISTS public.teacher_references (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_name    text NOT NULL CHECK (char_length(client_name) BETWEEN 1 AND 80),
  client_context text CHECK (char_length(client_context) <= 80),
  testimonial    text NOT NULL CHECK (char_length(testimonial) BETWEEN 10 AND 500),
  rating         smallint CHECK (rating BETWEEN 1 AND 5),
  reference_year smallint CHECK (reference_year BETWEEN 1990 AND 2030),
  is_public      boolean NOT NULL DEFAULT true,
  status         text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_references_teacher_idx ON public.teacher_references (teacher_user_id, sort_order);

ALTER TABLE public.teacher_references ENABLE ROW LEVEL SECURITY;

-- Public can read published public references
CREATE POLICY "public_read_teacher_references"
  ON public.teacher_references FOR SELECT
  USING (is_public = true AND status = 'published');

-- Teacher owner can manage their own references
CREATE POLICY "owner_manage_teacher_references"
  ON public.teacher_references FOR ALL
  USING (auth.uid() = teacher_user_id)
  WITH CHECK (auth.uid() = teacher_user_id);
