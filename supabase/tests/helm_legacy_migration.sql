begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(19);

select is(
  (select count(*)::integer from public.helm_account_state),
  2,
  'each authenticated legacy account receives independent account state'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'projects' and deleted_at is null),
  21,
  'golden project catalogue preserves the latest additive 21-project baseline'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'projects' and deleted_at is null
      and (payload ->> 'isPinned')::boolean),
  6,
  'golden project catalogue preserves exactly 6 pinned projects'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'projects' and deleted_at is null
      and not (payload ->> 'isPinned')::boolean
      and payload ->> 'status' <> 'archived'),
  13,
  'golden project catalogue preserves exactly 13 active unpinned projects'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'projects' and deleted_at is null
      and payload ->> 'status' = 'archived'),
  2,
  'golden project catalogue preserves exactly 2 archived projects'
);

select is(
  (
    select md5(jsonb_agg(payload order by position, record_id)::text)
    from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'projects' and deleted_at is null
  ),
  (
    select payload_hash
    from public.helm_test_store_expectation
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'projects'
  ),
  'golden project IDs, payloads, and ordering retain their canonical hash'
);

select ok(
  not exists (
    select 1
    from public.helm_test_store_expectation expected
    left join (
      select user_id, collection, count(*)::integer as normalized_count
      from public.helm_records
      where deleted_at is null
      group by user_id, collection
    ) normalized using (user_id, collection)
    where coalesce(normalized.normalized_count, 0) < expected.valid_count
  ),
  'normalized per-store record counts never decrease'
);

select ok(
  not exists (
    select 1
    from public.helm_test_store_expectation expected
    join lateral (
      select md5(jsonb_agg(payload order by position, record_id)::text) as normalized_hash
      from public.helm_records
      where user_id = expected.user_id
        and collection = expected.collection
        and deleted_at is null
    ) normalized on true
    where normalized.normalized_hash <> expected.payload_hash
  ),
  'canonical per-store payload hashes remain exact'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '22222222-2222-4222-8222-222222222222'
      and collection = 'financeAccounts'),
  1,
  'legacy xaoilin finance accounts remain isolated'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '22222222-2222-4222-8222-222222222222'
      and collection = 'transactions'),
  2,
  'legacy xaoilin transactions remain isolated'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '22222222-2222-4222-8222-222222222222'
      and collection = 'tasks'),
  1,
  'legacy xaoilin tasks remain isolated'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '22222222-2222-4222-8222-222222222222'
      and collection = 'conversations'),
  1,
  'legacy xaoilin conversations remain isolated'
);

select is(
  (select count(*)::integer from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'knowledgeEntries'),
  1,
  'only valid unique legacy records enter the active runtime'
);

select is(
  (select count(*)::integer from public.helm_legacy_quarantine
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'knowledgeEntries'),
  3,
  'malformed and ambiguous records are quarantined'
);

select is(
  (select count(*)::integer from public.helm_legacy_quarantine
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'settings'
      and reason = 'normalized_numeric_integration'),
  2,
  'numeric integration settings are archived after integration verification'
);

select ok(
  not exists (
    select 1
    from public.helm_records
    where collection = 'settings'
      and (
        payload ? '0' or payload ? '1'
        or payload ? 'deepgramApiKey'
        or payload ? 'supabaseAnonKey'
      )
  ),
  'malformed numeric settings and device credentials never enter shared records'
);

select ok(
  not exists (
    select 1
    from public.helm_test_legacy_snapshot expected
    join lateral (
      select md5(jsonb_agg(
        jsonb_build_object('namespace', namespace, 'key', key, 'value', value, 'updatedAt', updated_at)
        order by namespace, key
      )::text) as current_hash
      from public.kv_store
      where user_id = expected.user_id::text
    ) current on true
    where current.current_hash <> expected.snapshot_hash
  ),
  'the original kv_store rollback snapshot remains byte-equivalent'
);

select ok(
  not exists (
    select 1
    from public.helm_account_state state
    join lateral (
      select
        count(*) as row_count,
        encode(extensions.digest(convert_to(
          string_agg(kv.namespace || E'\x1f' || kv.key || E'\x1f' || kv.value::text, E'\x1e'
            order by kv.namespace, kv.key),
          'UTF8'
        ), 'sha256'), 'hex') as snapshot_sha256
      from public.kv_store kv
      where kv.user_id = state.user_id::text
    ) current on true
    where current.row_count <> (state.legacy_manifest ->> 'rowCount')::bigint
      or current.snapshot_sha256 <> state.legacy_manifest ->> 'snapshotSha256'
  ),
  'account manifests retain the cutover counts and canonical snapshot hashes'
);

select ok(
  exists (
    select 1 from public.kv_store
    where user_id = 'legacy-unowned-browser'
      and namespace = 'helm' and key = 'tasks'
  )
  and not exists (
    select 1 from public.helm_account_state
    where user_id::text = 'legacy-unowned-browser'
  )
  and not exists (
    select 1 from public.helm_records
    where user_id::text = 'legacy-unowned-browser'
  ),
  'unowned legacy rows remain recoverable but unattached'
);

select * from finish();
rollback;
