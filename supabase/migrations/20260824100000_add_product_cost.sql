-- Guarda o custo unitário importado da coluna O do catálogo.
-- O custo será usado pelo cruzamento das ofertas para desempatar produtos parecidos.
alter table public.products
  add column if not exists cost numeric(12,2);

comment on column public.products.cost is 'Custo unitário do produto, importado da coluna O da planilha do catálogo.';
