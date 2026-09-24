alter table public.products
  add column if not exists additional_eans text[] not null default '{}';

comment on column public.products.additional_eans is
  'Códigos de barras alternativos do mesmo cadastro, inclusive a coluna Código 2 do ERP.';

-- Consolida somente registros que têm o mesmo código interno, descrição e
-- dados comerciais. Registros homônimos com preço, custo ou estoque distintos
-- continuam separados e aparecem na aba Conflitos.
create temporary table _product_family_merge on commit drop as
select
  id,
  first_value(id) over (
    partition by user_id, category, internal_code, upper(btrim(description)), unit,
      unit_price, cost, stock_quantity
    order by (promotion_code is not null) desc, (image_url is not null) desc, created_at, id
  ) as keeper_id
from public.products
where nullif(btrim(internal_code), '') is not null;

delete from _product_family_merge where id = keeper_id;

with familias as (
  select
    mapa.keeper_id,
    array_agg(distinct codigo) filter (where codigo is not null and codigo <> '') as codigos,
    max(produto.image_url) filter (where nullif(btrim(produto.image_url), '') is not null) as imagem
  from _product_family_merge mapa
  join public.products produto on produto.id = mapa.id
  left join lateral unnest(array_prepend(produto.ean, produto.additional_eans)) codigo on true
  group by mapa.keeper_id
)
update public.products principal
set
  additional_eans = (
    select array_agg(distinct codigo)
    from unnest(
      coalesce(principal.additional_eans, '{}') ||
      coalesce(familias.codigos, '{}') ||
      case when principal.ean is null then '{}' else array[principal.ean] end
    ) codigo
    where codigo is distinct from principal.ean
  ),
  image_url = coalesce(principal.image_url, familias.imagem)
from familias
where principal.id = familias.keeper_id;

delete from public.products produto
using _product_family_merge mapa
where produto.id = mapa.id;

notify pgrst, 'reload schema';
