-- Garante que o banco do Nódus tenha a coluna usada pelo catálogo.
-- Idempotente: pode ser executada mesmo se a coluna já existir.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost numeric(12,2);

COMMENT ON COLUMN public.products.cost IS
  'Custo unitário do produto, importado da coluna O da planilha do catálogo.';

NOTIFY pgrst, 'reload schema';
