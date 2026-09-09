alter table public.catalog_imports
  add column if not exists stock_covered_count integer not null default 0,
  add column if not exists product_count integer not null default 0,
  add column if not exists inserted_product_ids uuid[] not null default '{}',
  add column if not exists post_import_fingerprint text;

create index if not exists catalog_imports_user_category_created_idx
  on public.catalog_imports(user_id, category, created_at desc, id desc);

create or replace function public.catalog_product_match_key(
  p_ean text,
  p_internal_code text,
  p_promotion_code text,
  p_description text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    'promocao:' || nullif(btrim(p_promotion_code), ''),
    'produto:'
      || coalesce(nullif(btrim(p_ean), ''), '')
      || ':'
      || coalesce(nullif(btrim(p_internal_code), ''), '')
      || ':'
      || btrim(
        regexp_replace(
          translate(
            lower(coalesce(p_description, '')),
            'áàãâäéèêëíìîïóòõôöúùûüçñ',
            'aaaaaeeeeiiiiooooouuuucn'
          ),
          '[^a-z0-9]+',
          ' ',
          'g'
        )
      )
  );
$$;

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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_category, 0)
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
    changed boolean not null default false
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
   and produto.category = p_category
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

  insert into pg_temp.catalog_import_match_candidates (ordinal, priority, product_id)
  select item.ordinal, 4, (array_agg(produto.id order by produto.id))[1]
  from pg_temp.catalog_import_items item
  join public.products produto
    on produto.user_id = v_user_id
   and produto.category = p_category
   and public.catalog_product_match_key(null, null, null, produto.description)
     = public.catalog_product_match_key(null, null, null, item.description)
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
    and (item.changed or item.stock_quantity is not null);

  -- Libera códigos que trocaram de produto dentro do mesmo arquivo antes do
  -- update final; conflitos com produtos de fora da carga continuam bloqueados.
  update public.products produto
  set promotion_code = null
  from pg_temp.catalog_import_items item
  where produto.id = item.existing_id
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

create or replace function public.undo_catalog_import(p_import_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  carga public.catalog_imports%rowtype;
  v_user_id uuid := (select auth.uid());
  v_category text;
  v_current_fingerprint text;
begin
  if v_user_id is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;

  select historico.category
  into v_category
  from public.catalog_imports historico
  where historico.id = p_import_id
    and historico.user_id = v_user_id;

  if not found then
    raise exception 'Carga não encontrada';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_category, 0)
  );

  select * into carga
  from public.catalog_imports
  where id = p_import_id
    and user_id = v_user_id
  for update;

  if carga.undone_at is not null then
    raise exception 'Carga já desfeita';
  end if;
  if carga.post_import_fingerprint is null then
    raise exception 'Esta carga é anterior ao histórico seguro e não pode ser desfeita automaticamente';
  end if;
  if exists (
    select 1
    from public.catalog_imports posterior
    where posterior.user_id = carga.user_id
      and posterior.category = carga.category
      and posterior.undone_at is null
      and (posterior.created_at, posterior.id) > (carga.created_at, carga.id)
  ) then
    raise exception 'Desfaça primeiro a carga mais recente desta categoria';
  end if;

  select md5(
    coalesce(
      jsonb_agg((to_jsonb(produto) - 'updated_at') order by produto.id),
      '[]'::jsonb
    )::text
  )
  into v_current_fingerprint
  from public.products produto
  where produto.user_id = carga.user_id
    and produto.category = carga.category;

  if v_current_fingerprint is distinct from carga.post_import_fingerprint then
    raise exception 'A categoria foi alterada depois desta carga. Revise as mudanças antes de desfazer.';
  end if;

  -- Remove somente registros criados por esta carga. Produtos adicionados
  -- por outro fluxo nunca são inferidos pela ausência no snapshot.
  delete from public.products produto
  where produto.user_id = carga.user_id
    and produto.category = carga.category
    and produto.id = any(carga.inserted_product_ids);

  -- Evita colisão temporária ao restaurar códigos promocionais que trocaram
  -- entre dois produtos da mesma categoria.
  update public.products produto
  set promotion_code = null
  from jsonb_populate_recordset(null::public.products, carga.snapshot) restaurado
  where produto.id = restaurado.id
    and produto.user_id = carga.user_id
    and produto.promotion_code is distinct from restaurado.promotion_code;

  insert into public.products (
    id, user_id, internal_code, ean, description, unit, unit_price, category,
    image_url, created_at, updated_at, promotion_code, cost, image_status,
    image_last_checked_at, image_search_version, stock_quantity, stock_updated_at
  )
  select
    coalesce(restaurado.id, gen_random_uuid()),
    carga.user_id,
    restaurado.internal_code,
    restaurado.ean,
    restaurado.description,
    restaurado.unit,
    restaurado.unit_price,
    carga.category,
    restaurado.image_url,
    coalesce(restaurado.created_at, now()),
    coalesce(restaurado.updated_at, now()),
    restaurado.promotion_code,
    restaurado.cost,
    coalesce(
      restaurado.image_status,
      case
        when nullif(btrim(restaurado.image_url), '') is null then 'pending'
        else 'found'
      end
    ),
    restaurado.image_last_checked_at,
    coalesce(restaurado.image_search_version, 2),
    restaurado.stock_quantity,
    restaurado.stock_updated_at
  from jsonb_populate_recordset(null::public.products, carga.snapshot) restaurado
  on conflict (id) do update set
    user_id = excluded.user_id,
    internal_code = excluded.internal_code,
    ean = excluded.ean,
    description = excluded.description,
    unit = excluded.unit,
    unit_price = excluded.unit_price,
    category = excluded.category,
    image_url = excluded.image_url,
    created_at = excluded.created_at,
    promotion_code = excluded.promotion_code,
    cost = excluded.cost,
    image_status = excluded.image_status,
    image_last_checked_at = excluded.image_last_checked_at,
    image_search_version = excluded.image_search_version,
    stock_quantity = excluded.stock_quantity,
    stock_updated_at = excluded.stock_updated_at;

  update public.catalog_imports
  set undone_at = now()
  where id = carga.id;
end;
$$;

revoke all on function public.catalog_product_match_key(text, text, text, text) from public;
grant execute on function public.catalog_product_match_key(text, text, text, text) to authenticated;
revoke all on function public.import_catalog(text, text, jsonb, integer, integer) from public;
grant execute on function public.import_catalog(text, text, jsonb, integer, integer) to authenticated;
revoke all on function public.undo_catalog_import(uuid) from public;
grant execute on function public.undo_catalog_import(uuid) to authenticated;

notify pgrst, 'reload schema';
