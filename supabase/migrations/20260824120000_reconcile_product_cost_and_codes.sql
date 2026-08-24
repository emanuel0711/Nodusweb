-- Garante o custo no banco e corrige a separação definitiva dos códigos.
-- Unidade: somente EAN.
-- Kg/balança: somente código interno.
-- Código de promoção permanece independente.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost numeric(12,2);

-- Se um produto por unidade tiver um EAN válido salvo por engano em código interno,
-- move o EAN para o campo correto antes de limpar o campo interno.
UPDATE public.products
SET ean = regexp_replace(internal_code, '[^0-9]', '', 'g'),
    internal_code = NULL
WHERE lower(coalesce(unit, '')) NOT IN ('kg', 'quilo', 'kilo', 'quilograma')
  AND lower(coalesce(description, '')) !~ '(^|[^a-z])(kg|quilo|kilo|quilograma)([^a-z]|$)'
  AND (ean IS NULL OR btrim(ean) = '')
  AND internal_code IS NOT NULL
  AND regexp_replace(internal_code, '[^0-9]', '', 'g') ~ '^[0-9]{12,14}$';

-- Produto por Kg nunca usa EAN. Se o EAN armazenado for um código curto de balança,
-- aproveita-o como código interno; EAN verdadeiro continua sendo descartado do campo EAN.
UPDATE public.products
SET internal_code = COALESCE(NULLIF(btrim(internal_code), ''),
                             CASE WHEN regexp_replace(coalesce(ean, ''), '[^0-9]', '', 'g') ~ '^[0-9]{1,7}$'
                                  THEN regexp_replace(ean, '[^0-9]', '', 'g') END),
    ean = NULL
WHERE lower(coalesce(unit, '')) IN ('kg', 'quilo', 'kilo', 'quilograma')
   OR lower(coalesce(description, '')) ~ '(^|[^a-z])(kg|quilo|kilo|quilograma)([^a-z]|$)';

-- Produtos por unidade nunca mantêm código interno, mesmo que o cadastro antigo tenha um valor.
UPDATE public.products
SET internal_code = NULL
WHERE lower(coalesce(unit, '')) NOT IN ('kg', 'quilo', 'kilo', 'quilograma')
  AND lower(coalesce(description, '')) !~ '(^|[^a-z])(kg|quilo|kilo|quilograma)([^a-z]|$)';

COMMENT ON COLUMN public.products.cost IS 'Custo unitário do produto, importado da coluna O da planilha do catálogo.';

NOTIFY pgrst, 'reload schema';
