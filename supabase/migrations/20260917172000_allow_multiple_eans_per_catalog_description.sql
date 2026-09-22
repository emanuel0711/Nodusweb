create or replace function public.import_catalog(
  p_file_name text,
  p_category text,
  p_products jsonb,
  p_ignored_count integer default 0,
  p_error_count integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := clock_timestamp();
  v_snapshot jsonb;
  v_payload_count integer;
  v_unique_count integer;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_ignored_count integer := 0;
  v_inserted_product_ids uuid[] := '{}';
  v_product_count integer := 0;
  v_stock_covered_count integer := 0;
  v_oldest_stock_at timestamptz;
  v_stock_updated_at timestamptz;
  v_post_import_fingerprint text;
  v_import public.catalog_imports%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  if nullif(btrim(p_file_name), '') is null then
    raise exception 'Informe o nome do arquivo.';
  end if;
  if nullif(btrim(p_category), '') is null then
    raise exception 'Informe a categoria do arquivo.';
  end if;
  if p_products is null
    or jsonb_typeof(p_products) <> 'array'
    or jsonb_array_length(p_products) = 0 then
    raise exception 'O arquivo não contém nenhum produto válido.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_products) item
    where jsonb_typeof(item) <> 'object'
      or nullif(btrim(item->>'description'), '') is null
      or coalesce(nullif(btrim(item->>'category'), ''), p_category) <> p_category
  ) then
    raise exception 'O arquivo contém produto inválido ou de outra categoria.';
  end if;

  -- O código promocional é único por usuário, não por categoria. Serializa as
  -- cargas do mesmo catálogo para que duas categorias não disputem o mesmo
  -- código durante a transação.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  select coalesce(jsonb_agg(to_jsonb(produto) order by produto.id), '[]'::jsonb)
  into v_snapshot
  from public.products produto
  where produto.user_id = v_user_id
    and produto.category = p_category;

  drop table if exists pg_temp.catalog_import_items;
  create temporary table catalog_import_items (
    ordinal bigint primary key,
    match_key text not null,
    existing_id uuid,
    internal_code text,
    promotion_code text,
    ean text,
    description text not null,
    unit text,
    unit_price numeric(12,2),
    cost numeric(12,2),
    stock_quantity numeric,
    image_url text,
    changed boolean not null default false,
    skip_existing boolean not null default false
  ) on commit drop;

  drop table if exists pg_temp.catalog_import_match_candidates;
  create temporary table catalog_import_match_candidates (
    ordinal bigint not null,
    priority smallint not null,
    product_id uuid not null,
    primary key (ordinal, priority)
  ) on commit drop;

  insert into catalog_import_items (
    ordinal, match_key, existing_id, internal_code, promotion_code, ean,
    description, unit, unit_price, cost, stock_quantity, image_url
  )
  select
    normalizado.ordinal,
    normalizado.match_key,
    null::uuid,
    nullif(btrim(normalizado.item->>'internal_code'), ''),
    nullif(btrim(normalizado.item->>'promotion_code'), ''),
    nullif(btrim(normalizado.item->>'ean'), ''),
    btrim(normalizado.item->>'description'),
    nullif(btrim(normalizado.item->>'unit'), ''),
    (normalizado.item->>'unit_price')::numeric,
    (normalizado.item->>'cost')::numeric,
    (normalizado.item->>'stock_quantity')::numeric,
    nullif(btrim(normalizado.item->>'image_url'), '')
  from (
    select
      origem.ordinal,
      origem.item,
      public.catalog_product_match_key(
        origem.item->>'ean',
        origem.item->>'internal_code',
        origem.item->>'promotion_code',
        origem.item->>'description'
      ) as match_key
    from jsonb_array_elements(p_products) with ordinality origem(item, ordinal)
  ) normalizado
  where nullif(normalizado.match_key, '') is not null
  order by normalizado.ordinal;

  get diagnostics v_unique_count = row_count;
  v_payload_count := jsonb_array_length(p_products);
  if v_unique_count = 0 then
    raise exception 'O arquivo não contém nenhum produto válido.';
  end if;

  -- Cada critério só produz candidato quando identifica exatamente um
  -- produto. O existing_id e o match_key enviados pelo navegador não são
  -- autoridade: ambos são recalculados dentro da transação.
  insert into pg_temp.catalog_import_match_candidates (ordinal, priority, product_id)
  select item.ordinal, 1, (array_agg(produto.id order by produto.id))[1]
  from pg_temp.catalog_import_items item
  join public.products produto
    on produto.user_id = v_user_id
   and item.promotion_code is not null
   and produto.promotion_code = item.promotion_code
  group by item.ordinal
  having count(*) = 1;

  insert into pg_temp.catalog_import_match_candidates (ordinal, priority, product_id)
  select item.ordinal, 2, (array_agg(produto.id order by produto.id))[1]
  from pg_temp.catalog_import_items item
  join public.products produto
    on produto.user_id = v_user_id
   and produto.category = p_category
   and item.internal_code is not null
   and produto.internal_code = item.internal_code
  group by item.ordinal
  having count(*) = 1;

  insert into pg_temp.catalog_import_match_candidates (ordinal, priority, product_id)
  select item.ordinal, 3, (array_agg(produto.id order by produto.id))[1]
  from pg_temp.catalog_import_items item
  join public.products produto
    on produto.user_id = v_user_id
   and produto.category = p_category
   and item.ean is not null
   and produto.ean = item.ean
  group by item.ordinal
  having count(*) = 1;

  -- A descrição é apenas o último recurso. Quando uma linha do ERP gera dois
  -- EANs, somente uma delas pode herdar o cadastro antigo; a outra precisa ser
  -- inserida como código adicional da mesma família. Identificadores exatos
  -- sempre têm prioridade e reservam o produto antes deste fallback.
  with itens_normalizados as materialized (
    select
      item.ordinal,
      public.catalog_product_match_key(null, null, null, item.description) as description_key
    from pg_temp.catalog_import_items item
    where not exists (
      select 1
      from pg_temp.catalog_import_match_candidates exato
      where exato.ordinal = item.ordinal
    )
  ),
  primeira_linha_por_descricao as materialized (
    select ordinal, description_key
    from (
      select
        normalizado.ordinal,
        normalizado.description_key,
        row_number() over (
          partition by normalizado.description_key
          order by normalizado.ordinal
        ) as posicao
      from itens_normalizados normalizado
    ) ranqueado
    where ranqueado.posicao = 1
  ),
  produtos_disponiveis as materialized (
    select
      produto.id,
      public.catalog_product_match_key(null, null, null, produto.description) as description_key
    from public.products produto
    where produto.user_id = v_user_id
      and produto.category = p_category
      and not exists (
        select 1
        from pg_temp.catalog_import_match_candidates reservado
        where reservado.product_id = produto.id
      )
  )
  insert into pg_temp.catalog_import_match_candidates (ordinal, priority, product_id)
  select item.ordinal, 4, (array_agg(produto.id order by produto.id))[1]
  from primeira_linha_por_descricao item
  join produtos_disponiveis produto
    on produto.description_key = item.description_key
  group by item.ordinal
  having count(*) = 1;

  if exists (
    select 1
    from pg_temp.catalog_import_match_candidates candidato
    group by candidato.ordinal
    having count(distinct candidato.product_id) > 1
  ) then
    raise exception 'Os identificadores do arquivo correspondem a produtos diferentes. Revise códigos e descrição antes de importar.';
  end if;

  update pg_temp.catalog_import_items item
  set existing_id = escolhido.product_id
  from (
    select
      candidato.ordinal,
      (array_agg(candidato.product_id order by candidato.priority))[1] as product_id
    from pg_temp.catalog_import_match_candidates candidato
    group by candidato.ordinal
  ) escolhido
  where item.ordinal = escolhido.ordinal;

  -- Um código promocional já cadastrado em outra categoria representa o
  -- mesmo produto global. Ele deve ser ignorado nesta carga, não reinserido
  -- (violaria o índice único) nem movido silenciosamente de categoria.
  update pg_temp.catalog_import_items item
  set skip_existing = true
  from public.products produto
  where produto.id = item.existing_id
    and produto.user_id = v_user_id
    and produto.category is distinct from p_category;

  if exists (
    select 1
    from pg_temp.catalog_import_items item
    where item.existing_id is not null
    group by item.existing_id
    having count(*) > 1
  ) then
    raise exception 'Duas linhas do arquivo correspondem ao mesmo produto. Corrija a duplicidade antes de importar.';
  end if;

  update pg_temp.catalog_import_items item
  set changed = true
  from public.products produto
  where produto.id = item.existing_id
    and produto.user_id = v_user_id
    and not item.skip_existing
    and row(
      produto.internal_code,
      produto.promotion_code,
      produto.ean,
      produto.description,
      produto.unit,
      produto.unit_price,
      produto.cost,
      produto.stock_quantity,
      produto.image_url
    ) is distinct from row(
      item.internal_code,
      item.promotion_code,
      item.ean,
      item.description,
      item.unit,
      item.unit_price,
      coalesce(item.cost, produto.cost),
      coalesce(item.stock_quantity, produto.stock_quantity),
      coalesce(item.image_url, produto.image_url)
    );

  select count(*)
  into v_updated_count
  from pg_temp.catalog_import_items item
  where item.existing_id is not null
    and not item.skip_existing
    and (item.changed or item.stock_quantity is not null);

  -- Libera códigos que trocaram de produto dentro do mesmo arquivo antes do
  -- update final; conflitos com produtos de fora da carga continuam bloqueados.
  update public.products produto
  set promotion_code = null
  from pg_temp.catalog_import_items item
  where produto.id = item.existing_id
    and not item.skip_existing
    and item.changed
    and produto.promotion_code is distinct from item.promotion_code;

  update public.products produto
  set
    internal_code = item.internal_code,
    promotion_code = item.promotion_code,
    ean = item.ean,
    description = item.description,
    unit = item.unit,
    unit_price = item.unit_price,
    cost = coalesce(item.cost, produto.cost),
    category = p_category,
    image_url = coalesce(item.image_url, produto.image_url),
    image_status = case
      when item.image_url is not null then 'found'
      else produto.image_status
    end,
    stock_quantity = coalesce(item.stock_quantity, produto.stock_quantity),
    stock_updated_at = case
      when item.stock_quantity is null then produto.stock_updated_at
      else v_now
    end
  from pg_temp.catalog_import_items item
  where produto.id = item.existing_id
    and produto.user_id = v_user_id
    and not item.skip_existing
    and (item.changed or item.stock_quantity is not null);

  with inseridos as (
    insert into public.products (
      user_id, internal_code, promotion_code, ean, description, unit,
      unit_price, cost, category, image_url, image_status,
      stock_quantity, stock_updated_at
    )
    select
      v_user_id,
      item.internal_code,
      item.promotion_code,
      item.ean,
      item.description,
      item.unit,
      item.unit_price,
      item.cost,
      p_category,
      coalesce(
        item.image_url,
        (
          select semelhante.image_url
          from public.products semelhante
          where semelhante.user_id = v_user_id
            and semelhante.ean = item.ean
            and nullif(btrim(semelhante.image_url), '') is not null
          order by semelhante.id
          limit 1
        )
      ),
      case
        when coalesce(
          item.image_url,
          (
            select semelhante.image_url
            from public.products semelhante
            where semelhante.user_id = v_user_id
              and semelhante.ean = item.ean
              and nullif(btrim(semelhante.image_url), '') is not null
            order by semelhante.id
            limit 1
          )
        ) is null then 'pending'
        else 'found'
      end,
      item.stock_quantity,
      case when item.stock_quantity is null then null else v_now end
    from pg_temp.catalog_import_items item
    where item.existing_id is null
    returning id
  )
  select
    count(*),
    coalesce(array_agg(inseridos.id order by inseridos.id), '{}'::uuid[])
  into v_inserted_count, v_inserted_product_ids
  from inseridos;

  select
    count(*),
    count(*) filter (
      where produto.stock_quantity is not null
        and produto.stock_updated_at is not null
    ),
    min(produto.stock_updated_at) filter (
      where produto.stock_quantity is not null
        and produto.stock_updated_at is not null
    )
  into v_product_count, v_stock_covered_count, v_oldest_stock_at
  from public.products produto
  where produto.user_id = v_user_id
    and produto.category = p_category;

  if v_product_count > 0 and v_stock_covered_count = v_product_count then
    v_stock_updated_at := v_oldest_stock_at;
  else
    v_stock_updated_at := null;
  end if;

  select md5(
    coalesce(
      jsonb_agg((to_jsonb(produto) - 'updated_at') order by produto.id),
      '[]'::jsonb
    )::text
  )
  into v_post_import_fingerprint
  from public.products produto
  where produto.user_id = v_user_id
    and produto.category = p_category;

  v_ignored_count := greatest(coalesce(p_ignored_count, 0), 0)
    + (v_payload_count - v_unique_count)
    + (v_unique_count - v_inserted_count - v_updated_count);

  insert into public.catalog_imports (
    user_id, file_name, category, inserted_count, updated_count,
    ignored_count, error_count, snapshot, stock_updated_at,
    stock_covered_count, product_count, inserted_product_ids,
    post_import_fingerprint
  )
  values (
    v_user_id, btrim(p_file_name), p_category, v_inserted_count,
    v_updated_count, v_ignored_count, greatest(coalesce(p_error_count, 0), 0),
    v_snapshot, v_stock_updated_at, v_stock_covered_count, v_product_count,
    v_inserted_product_ids, v_post_import_fingerprint
  )
  returning * into v_import;

  return to_jsonb(v_import) - 'snapshot';
end;
$$;

notify pgrst, 'reload schema';

