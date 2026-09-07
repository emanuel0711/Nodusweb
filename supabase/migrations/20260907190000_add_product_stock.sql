alter table public.products
  add column if not exists stock_quantity numeric,
  add column if not exists stock_updated_at timestamptz;

comment on column public.products.stock_quantity is
  'Quantidade disponível na última carga de estoque; NULL significa estoque ainda não informado.';

comment on column public.products.stock_updated_at is
  'Data e hora da última atualização de estoque deste produto.';
