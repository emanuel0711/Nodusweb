create table if not exists public.catalog_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  category text not null,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  ignored_count integer not null default 0,
  error_count integer not null default 0,
  snapshot jsonb not null default '[]'::jsonb,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.catalog_imports enable row level security;
grant select, insert, update, delete on public.catalog_imports to authenticated;
create policy "Users manage own catalog imports" on public.catalog_imports
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create index if not exists catalog_imports_user_created_idx
  on public.catalog_imports(user_id, created_at desc);

create table if not exists public.offer_match_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_key text not null,
  codes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique(user_id, offer_key)
);

alter table public.offer_match_memory enable row level security;
grant select, insert, update, delete on public.offer_match_memory to authenticated;
create policy "Users manage own offer match memory" on public.offer_match_memory
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.undo_catalog_import(p_import_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare carga public.catalog_imports%rowtype;
begin
  select * into carga from public.catalog_imports
  where id = p_import_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'Carga não encontrada'; end if;
  if carga.undone_at is not null then raise exception 'Carga já desfeita'; end if;
  delete from public.products where user_id = carga.user_id and category = carga.category;
  insert into public.products
  select * from jsonb_populate_recordset(null::public.products, carga.snapshot);
  update public.catalog_imports set undone_at = now() where id = carga.id;
end;
$$;
revoke all on function public.undo_catalog_import(uuid) from public;
grant execute on function public.undo_catalog_import(uuid) to authenticated;
