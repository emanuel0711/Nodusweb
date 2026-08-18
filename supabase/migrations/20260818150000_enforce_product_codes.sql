-- Product codes come from column B of the source CSVs and must identify one product only.
-- Keep the newest row when legacy duplicate codes already exist, then enforce uniqueness.
DELETE FROM public.products p
USING public.products newer
WHERE p.user_id = newer.user_id
  AND p.internal_code IS NOT NULL
  AND p.internal_code <> ''
  AND p.internal_code = newer.internal_code
  AND newer.created_at > p.created_at;

DELETE FROM public.products p
USING public.products newer
WHERE p.user_id = newer.user_id
  AND p.ean IS NOT NULL
  AND p.ean <> ''
  AND p.ean = newer.ean
  AND newer.created_at > p.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS products_user_internal_code_unique
  ON public.products(user_id, internal_code)
  WHERE internal_code IS NOT NULL AND internal_code <> '';

CREATE UNIQUE INDEX IF NOT EXISTS products_user_ean_unique
  ON public.products(user_id, ean)
  WHERE ean IS NOT NULL AND ean <> '';
