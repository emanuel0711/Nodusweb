-- Garante que o catálogo tenha o campo usado pelo filtro de custo das ofertas.
alter table public.products
  add column if not exists cost numeric(12,2);

comment on column public.products.cost is 'Custo unitário do produto, importado da coluna O da planilha do catálogo.';

-- Atualiza o cache do PostgREST quando a migração for aplicada.
notify pgrst, 'reload schema';
