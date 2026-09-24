-- Cargas antigas de produtos por unidade descartavam o código interno. Nesses
-- casos, descrição e dados comerciais idênticos ainda identificam com segurança
-- as linhas físicas que representam EANs do mesmo cadastro.
create temporary table _legacy_product_family_merge on commit drop as
select
  id,
  first_value(id) over (
    partition by user_id, category, upper(btrim(description)), unit,
      unit_price, cost, stock_quantity
    order by (promotion_code is not null) desc, (image_url is not null) desc, created_at, id
  ) as keeper_id
from public.products;

delete from _legacy_product_family_merge where id = keeper_id;

with familias as (
  select
    mapa.keeper_id,
    array_agg(distinct codigo) filter (where codigo is not null and codigo <> '') as codigos,
    max(produto.image_url) filter (where nullif(btrim(produto.image_url), '') is not null) as imagem
  from _legacy_product_family_merge mapa
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
using _legacy_product_family_merge mapa
where produto.id = mapa.id;

notify pgrst, 'reload schema';
