begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

select has_table(
  'public', 'helm_legacy_quarantine',
  'legacy quarantine schema exists'
);
select ok(
  exists (
    select 1
    from public.helm_account_state
    where user_id = '11111111-1111-4111-8111-111111111111'
      and schema_version = 1
      and account_version = 1
      and migrated_at is not null
  ),
  'migration creates account state for the first authenticated account'
);
select ok(
  exists (
    select 1
    from public.helm_account_state
    where user_id = '22222222-2222-4222-8222-222222222222'
      and schema_version = 1
      and account_version = 1
      and migrated_at is not null
  ),
  'migration creates independent state for the second authenticated account'
);
select is(
  (select legacy_manifest ->> 'rowCount'
   from public.helm_account_state
   where user_id = '11111111-1111-4111-8111-111111111111'),
  '4',
  'the first account manifest counts every legacy row'
);
select is(
  (select legacy_manifest ->> 'rowCount'
   from public.helm_account_state
   where user_id = '22222222-2222-4222-8222-222222222222'),
  '1',
  'the second account manifest is independent'
);
select is(
  (select minimum_client_version
   from public.helm_account_state
   where user_id = '11111111-1111-4111-8111-111111111111'),
  '0.2.83',
  'migration state keeps the complete-snapshot client floor'
);
select ok(
  (select legacy_manifest ->> 'snapshotSha256'
   from public.helm_account_state
   where user_id = '11111111-1111-4111-8111-111111111111') =
  encode(extensions.digest(convert_to(
    (select string_agg(namespace || E'\x1f' || key || E'\x1f' || value::text, E'\x1e'
      order by namespace, key)
     from public.kv_store
     where user_id = '11111111-1111-4111-8111-111111111111'),
    'UTF8'
  ), 'sha256'), 'hex'),
  'the account manifest records the complete legacy source digest'
);
select is(
  (select count(*)::integer
   from public.kv_store
   where user_id = '11111111-1111-4111-8111-111111111111'),
  4,
  'the first account legacy rows remain in the rollback table'
);
select ok(
  exists (
    select 1
    from public.kv_store
    where user_id = '11111111-1111-4111-8111-111111111111'
      and namespace = 'helm'
      and key = 'settings'
      and value ->> 'deepgramApiKey' = 'legacy-device-secret'
      and value ->> 'supabaseAnonKey' = 'legacy-browser-key'
  ),
  'legacy settings, including non-normalized fields, are preserved verbatim'
);
select ok(
  exists (
    select 1
    from public.kv_store
    where user_id = '11111111-1111-4111-8111-111111111111'
      and namespace = 'helm'
      and key = 'projects'
      and value -> 0 ->> 'localPath' = '/private/account-a'
  ),
  'legacy project data remains available in the rollback source'
);
select ok(
  exists (
    select 1
    from public.kv_store
    where user_id = 'legacy-unowned-browser'
      and namespace = 'helm'
      and key = 'tasks'
      and value -> 0 ->> 'id' = 'unowned-task'
  ),
  'unowned browser data remains untouched in the legacy table'
);
select is(
  (select count(*)::integer from public.helm_account_state),
  2,
  'unowned legacy data does not create account state'
);
select is(
  (select count(*)::integer
   from public.helm_records
   where user_id = '11111111-1111-4111-8111-111111111111'),
  4,
  'valid legacy rows become four account-owned records'
);
select is(
  (select count(*)::integer
   from public.helm_records
   where user_id = '22222222-2222-4222-8222-222222222222'),
  1,
  'the second account receives only its own valid record'
);
select ok(
  exists (
    select 1
    from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'settings'
      and record_id = 'singleton'
      and payload ->> 'theme' = 'dark'
      and payload ->> 'telemetry' = 'false'
      and not (payload ? 'deepgramApiKey')
      and not (payload ? 'supabaseAnonKey')
  ),
  'normalized settings retain only the migration whitelist'
);
select ok(
  exists (
    select 1
    from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'projects'
      and record_id = 'a-project'
      and payload ->> 'name' = 'Account A project'
      and not (payload ? 'localPath')
  ),
  'normalized projects remove machine-local fields'
);
select ok(
  exists (
    select 1
    from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'knowledgeEntries'
      and record_id = 'a-note'
      and payload ->> 'title' = 'Retained note'
  ),
  'a valid stable id is normalized into an active record'
);
select is(
  (select count(*)::integer
   from public.helm_legacy_quarantine
   where user_id = '11111111-1111-4111-8111-111111111111'),
  3,
  'invalid legacy entries are retained in quarantine'
);
select is(
  (select count(*)::integer
   from public.helm_legacy_quarantine
   where user_id = '11111111-1111-4111-8111-111111111111'
     and collection = 'knowledgeEntries'
     and reason = 'missing_stable_id'),
  1,
  'missing stable ids are quarantined explicitly'
);
select is(
  (select count(*)::integer
   from public.helm_legacy_quarantine
   where user_id = '11111111-1111-4111-8111-111111111111'
     and collection = 'knowledgeEntries'
     and reason = 'duplicate_stable_id'),
  2,
  'duplicate stable ids are quarantined without choosing a winner'
);
select ok(
  not exists (
    select 1
    from public.helm_records
    where account_version <> 1
  ),
  'migration-created records share the initial account version'
);
select ok(
  exists (
    select 1
    from public.helm_legacy_quarantine
    where user_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'knowledgeEntries'
      and reason = 'missing_stable_id'
      and payload -> 'value' ->> 'title' = 'Missing stable id'
  ),
  'quarantine keeps the original invalid payload for recovery'
);

select * from finish();
rollback;
