-- Controla o ciclo de vida da busca de imagens para evitar reprocessamento infinito.
-- Produtos com imagem ficam como found; os demais começam como pending.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS image_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS image_search_version integer NOT NULL DEFAULT 1;

UPDATE public.products
SET image_status = CASE
  WHEN image_url IS NOT NULL AND btrim(image_url) <> '' THEN 'found'
  ELSE 'pending'
END
WHERE image_status IS NULL OR image_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_products_image_status
  ON public.products (image_status);

CREATE INDEX IF NOT EXISTS idx_products_image_search_version
  ON public.products (image_search_version);

COMMENT ON COLUMN public.products.image_status IS
  'Estado da busca de imagem: pending, found, not_found, pending_approval, rejected ou manual.';
COMMENT ON COLUMN public.products.image_last_checked_at IS
  'Última vez em que o produto passou pelo fluxo de busca de imagem.';
COMMENT ON COLUMN public.products.image_search_version IS
  'Versão das fontes/regras usadas na última busca de imagem.';
