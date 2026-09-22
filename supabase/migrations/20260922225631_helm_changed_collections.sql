begin;

-- Reconcile missed Broadcast notifications using retained record versions,
-- including tombstones, without reading account payloads. State, collection
-- names and the secret invalidation flag use one statement snapshot.
create function public.get_helm_changed_collections(p_since_version bigint)
returns jsonb
language plpgsql
stable
-- Definer access is required for the protected secret metadata table; every
-- read is bound to the first-party caller below, with no secret table grants.
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false)
    or nullif((select auth.jwt() ->> 'client_id'), '') is not null then
    raise exception 'This session cannot read Sabah One change metadata.' using errcode = '42501';
  end if;
  if p_since_version is null or p_since_version < 0 then
    raise exception 'A nonnegative Sabah One account version is required.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'accountVersion', coalesce((
      select state.account_version from public.helm_account_state as state
      where state.user_id = v_user_id
    ), 0),
    'collections', coalesce((
      select jsonb_agg(changed.collection order by changed.collection)
      from (
        select distinct record.collection
        from public.helm_records as record
        where record.user_id = v_user_id and record.account_version > p_since_version
      ) as changed
    ), '[]'::jsonb),
    'secretsChanged', exists (
      select 1 from public.helm_secret_entries as secret
      where secret.user_id = v_user_id and secret.account_version > p_since_version
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_helm_changed_collections(bigint) from public, anon;
grant execute on function public.get_helm_changed_collections(bigint) to authenticated;

commit;
