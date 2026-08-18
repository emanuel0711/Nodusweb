-- Product codes come from column B of the source CSVs and must identify one product only.
-- Keep the newest row when legacy duplicate codes already exist, then enforce uniqueness.
DELETE FROM public.products p
USING public.products older
WHERE p.user_id = older.user_id
  AND p.internal_code IS NOT NULL
  AND p.internal_code <> ''
  AND p.internal_code = older.internal_code
  AND p.created_at > older.created_at;

DELETE FROM public.products p
USING public.products older
WHERE p.user_id = older.user_id
  AND p.ean IS NOT NULL
  AND p.ean <> ''
  AND p.ean = older.ean
  AND p.created_at > older.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS products_user_internal_code_unique
  ON public.products(user_id, internal_code)
  WHERE internal_code IS NOT NULL AND internal_code <> '';

CREATE UNIQUE INDEX IF NOT EXISTS products_user_ean_unique
  ON public.products(user_id, ean)
  WHERE ean IS NOT NULL AND ean <> '';
