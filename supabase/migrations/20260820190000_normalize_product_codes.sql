-- Normaliza registros antigos criados quando o código promocional era usado
-- como fallback para EAN/código interno.
-- Regra definitiva:
--   unidade -> EAN
--   Kg/balança -> código interno
--   promotion_code -> somente código promocional explícito

-- 1) Se um EAN foi salvo por engano em promotion_code, recupera-o como EAN.
UPDATE public.products
SET ean = regexp_replace(promotion_code, '[^0-9]', '', 'g'),
    promotion_code = NULL
WHERE (ean IS NULL OR btrim(ean) = '')
  AND promotion_code IS NOT NULL
  AND regexp_replace(promotion_code, '[^0-9]', '', 'g') ~ '^[0-9]{12,14}$';

-- 2) Se um EAN foi salvo por engano em internal_code, recupera-o como EAN.
UPDATE public.products
SET ean = regexp_replace(internal_code, '[^0-9]', '', 'g'),
    internal_code = NULL
WHERE (ean IS NULL OR btrim(ean) = '')
  AND internal_code IS NOT NULL
  AND regexp_replace(internal_code, '[^0-9]', '', 'g') ~ '^[0-9]{12,14}$';

-- 3) Produtos de Kg que receberam o código curto da balança em promotion_code
-- passam a ter esse código no campo correto.
UPDATE public.products
SET internal_code = btrim(promotion_code),
    promotion_code = NULL
WHERE (internal_code IS NULL OR btrim(internal_code) = '')
  AND promotion_code IS NOT NULL
  AND btrim(promotion_code) ~ '^[0-9]{1,7}$'
  AND (
    lower(coalesce(unit, '')) IN ('kg', 'quilo', 'kilo', 'quilograma')
    OR lower(coalesce(description, '')) ~ '(^|[^a-z])kg([^a-z]|$)|quilograma|quilo|kilo'
  );

-- 4) Remove duplicação: EAN nunca deve ficar repetido em promotion_code/internal_code.
UPDATE public.products
SET promotion_code = NULL
WHERE promotion_code IS NOT NULL
  AND ean IS NOT NULL
  AND regexp_replace(promotion_code, '[^0-9]', '', 'g') = regexp_replace(ean, '[^0-9]', '', 'g');

UPDATE public.products
SET internal_code = NULL
WHERE internal_code IS NOT NULL
  AND ean IS NOT NULL
  AND regexp_replace(internal_code, '[^0-9]', '', 'g') = regexp_replace(ean, '[^0-9]', '', 'g');
