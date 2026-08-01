begin;

create or replace function public.get_helm_account_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'state', coalesce(
      (
        select jsonb_build_object(
          'userId', state.user_id,
          'schemaVersion', state.schema_version,
          'accountVersion', state.account_version,
          'minimumClientVersion', state.minimum_client_version,
          'migratedAt', state.migrated_at,
          'updatedAt', state.updated_at
        )
        from public.helm_account_state as state
        where state.user_id = (select auth.uid())
      ),
      jsonb_build_object(
        'userId', (select auth.uid()),
        'schemaVersion', 1,
        'accountVersion', 0,
        'minimumClientVersion', '0.2.83',
        'migratedAt', null,
        'updatedAt', '1970-01-01T00:00:00.000Z'
      )
    ),
    'records', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'userId', record.user_id,
            'collection', record.collection,
            'recordId', record.record_id,
            'payload', record.payload,
            'position', record.position,
            'revision', record.revision,
            'accountVersion', record.account_version,
            'createdAt', record.created_at,
            'updatedAt', record.updated_at,
            'deletedAt', record.deleted_at
          )
          order by record.collection, record.record_id
        )
        from public.helm_records as record
        where record.user_id = (select auth.uid())
      ),
      '[]'::jsonb
    )
  )
$$;

revoke all on function public.get_helm_account_snapshot() from public, anon;
grant execute on function public.get_helm_account_snapshot() to authenticated;

commit;
