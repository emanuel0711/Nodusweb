ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS promotion_code TEXT;

CREATE INDEX IF NOT EXISTS products_user_promotion_code_idx
  ON public.products(user_id, promotion_code);

-- The promotion/checkout code is the operational code from column B of the source CSV.
-- It is distinct from the EAN and from the system's internal database id.
CREATE UNIQUE INDEX IF NOT EXISTS products_user_promotion_code_unique
  ON public.products(user_id, promotion_code)
  WHERE promotion_code IS NOT NULL AND promotion_code <> '';
