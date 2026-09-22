begin;

-- First-party page hydration reads metadata and only its requested collections
-- in one statement snapshot. An empty array intentionally reads metadata alone.
create function public.get_helm_account_snapshot_for_collections(p_collections text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false)
    or nullif((select auth.jwt() ->> 'client_id'), '') is not null then
    raise exception 'This session cannot read a Sabah One account snapshot.' using errcode = '42501';
  end if;
  if p_collections is null then
    raise exception 'Requested Sabah One collections are required.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'state', coalesce(
      (select jsonb_build_object(
        'userId', state.user_id, 'schemaVersion', state.schema_version,
        'accountVersion', state.account_version,
        'minimumClientVersion', state.minimum_client_version,
        'migratedAt', state.migrated_at, 'updatedAt', state.updated_at
      ) from public.helm_account_state as state where state.user_id = v_user_id),
      jsonb_build_object(
        'userId', v_user_id, 'schemaVersion', 1, 'accountVersion', 0,
        'minimumClientVersion', '0.2.86', 'migratedAt', null,
        'updatedAt', '1970-01-01T00:00:00.000Z'
      )
    ),
    'records', coalesce((select jsonb_agg(jsonb_build_object(
      'userId', record.user_id, 'collection', record.collection,
      'recordId', record.record_id, 'payload', record.payload,
      'position', record.position, 'revision', record.revision,
      'accountVersion', record.account_version, 'createdAt', record.created_at,
      'updatedAt', record.updated_at, 'deletedAt', record.deleted_at
    ) order by record.collection, record.record_id)
    from public.helm_records as record
    where record.user_id = v_user_id and record.collection = any(p_collections)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_helm_account_snapshot_for_collections(text[]) from public, anon;
grant execute on function public.get_helm_account_snapshot_for_collections(text[]) to authenticated;

commit;
