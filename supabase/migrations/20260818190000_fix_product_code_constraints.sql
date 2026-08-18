-- The operational promotion/checkout code (CSV column B) is the only code
-- that must be unique per product. EAN and the system's internal code are
-- separate identifiers and must not block importing otherwise valid rows.
DROP INDEX IF EXISTS public.products_user_internal_code_unique;
DROP INDEX IF EXISTS public.products_user_ean_unique;

CREATE UNIQUE INDEX IF NOT EXISTS products_user_promotion_code_unique
  ON public.products(user_id, promotion_code)
  WHERE promotion_code IS NOT NULL AND promotion_code <> '';
