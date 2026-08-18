-- Older importer versions mistakenly stored the CSV column-B operational code in ean.
-- Recover those short codes without touching legitimate EAN-8+ values.
UPDATE public.products
SET promotion_code = ean,
    ean = NULL
WHERE promotion_code IS NULL
  AND ean IS NOT NULL
  AND regexp_replace(ean, '\\D', '', 'g') = ean
  AND length(ean) BETWEEN 1 AND 7;

-- If the legacy import produced the same short operational code more than once,
-- keep the oldest row and clear the duplicate so the unique promotion-code index remains valid.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id, promotion_code ORDER BY created_at ASC, id ASC) AS rn
  FROM public.products
  WHERE promotion_code IS NOT NULL AND promotion_code <> ''
)
UPDATE public.products p
SET promotion_code = NULL
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;
