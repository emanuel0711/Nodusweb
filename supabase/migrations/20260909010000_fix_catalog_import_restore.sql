alter table public.catalog_imports
  add column if not exists stock_updated_at timestamptz;

create or replace function public.undo_catalog_import(p_import_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  carga public.catalog_imports%rowtype;
begin
  select * into carga
  from public.catalog_imports
  where id = p_import_id and user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'Carga não encontrada';
  end if;
  if carga.undone_at is not null then
    raise exception 'Carga já desfeita';
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

  delete from public.products
  where user_id = carga.user_id and category = carga.category;

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
    restaurado.category,
    restaurado.image_url,
    coalesce(restaurado.created_at, now()),
    coalesce(restaurado.updated_at, now()),
    restaurado.promotion_code,
    restaurado.cost,
    coalesce(restaurado.image_status, 'pending'),
    restaurado.image_last_checked_at,
    coalesce(restaurado.image_search_version, 2),
    restaurado.stock_quantity,
    restaurado.stock_updated_at
  from jsonb_populate_recordset(null::public.products, carga.snapshot) restaurado;

  update public.catalog_imports
  set undone_at = now()
  where id = carga.id;
end;
$$;

revoke all on function public.undo_catalog_import(uuid) from public;
grant execute on function public.undo_catalog_import(uuid) to authenticated;

notify pgrst, 'reload schema';
