alter table public.offer_match_memory
  add column if not exists candidate_codes text[] not null default '{}';

create or replace function public.save_offer_match_memory(
  p_offer_key text,
  p_codes text[],
  p_candidate_codes text[],
  p_updated_at timestamptz
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  resultado public.offer_match_memory%rowtype;
  usuario uuid := (select auth.uid());
begin
  if usuario is null then
    raise exception 'Sessão expirada';
  end if;

  insert into public.offer_match_memory (
    user_id, offer_key, codes, candidate_codes, updated_at
  ) values (
    usuario,
    p_offer_key,
    coalesce(p_codes, '{}'),
    coalesce(p_candidate_codes, '{}'),
    -- p_updated_at permanece na assinatura para clientes já publicados, mas
    -- o relógio do navegador não decide mais qual correção é a mais nova.
    clock_timestamp()
  )
  on conflict (user_id, offer_key) do update
  set
    codes = excluded.codes,
    candidate_codes = excluded.candidate_codes,
    updated_at = clock_timestamp()
  where p_updated_at is not null
    and public.offer_match_memory.updated_at = p_updated_at
  returning * into resultado;

  return resultado.updated_at;
end;
$$;

revoke all on function public.save_offer_match_memory(text, text[], text[], timestamptz)
  from public;
grant execute on function public.save_offer_match_memory(text, text[], text[], timestamptz)
  to authenticated;

notify pgrst, 'reload schema';
