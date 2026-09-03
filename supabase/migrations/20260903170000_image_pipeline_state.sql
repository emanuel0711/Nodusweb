-- Persist image-search state and review candidates in Supabase.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS image_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS image_search_version integer NOT NULL DEFAULT 2;

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_image_status_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_image_status_check
  CHECK (image_status IN ('pending', 'processing', 'pending_approval', 'not_found', 'found', 'manual'));

UPDATE public.products
SET
  image_status = CASE
    WHEN image_url IS NOT NULL AND btrim(image_url) <> '' THEN 'found'
    WHEN image_status NOT IN ('pending', 'processing', 'pending_approval', 'not_found', 'found', 'manual') THEN 'pending'
    ELSE image_status
  END,
  image_search_version = GREATEST(COALESCE(image_search_version, 1), 2);

CREATE TABLE IF NOT EXISTS public.image_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url text NOT NULL,
  source text NOT NULL,
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  score_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  width integer,
  height integer,
  background_score numeric(5,4),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (product_id, url)
);

CREATE INDEX IF NOT EXISTS image_candidates_user_status_idx
  ON public.image_candidates (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS image_candidates_product_idx
  ON public.image_candidates (product_id, score DESC);

ALTER TABLE public.image_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own image candidates" ON public.image_candidates;
CREATE POLICY "Users manage own image candidates"
  ON public.image_candidates
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.products p
      WHERE p.id = product_id
        AND p.user_id = auth.uid()
    )
  );
