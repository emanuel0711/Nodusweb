ALTER TABLE public.products ADD COLUMN IF NOT EXISTS promotion_code text;
CREATE INDEX IF NOT EXISTS products_promotion_code_idx ON public.products (user_id, promotion_code);
CREATE INDEX IF NOT EXISTS products_ean_idx ON public.products (user_id, ean);