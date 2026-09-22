-- KAN-320: opt-in LOCAL synthetic benchmark; never point this at hosted data.
-- Run from the repo root (no reset/migration/production access is needed):
-- docker exec -i supabase_db_helm psql -U postgres -d postgres -X -qAt \
--   -v ON_ERROR_STOP=1 -v kan320_local_fixture=1 \
--   < scripts/benchmark-helm-query-indexes.sql > /tmp/kan320-query-plans.jsonl
-- Read-only catalog inspection plus temporary tables/functions, all rolled back.
-- Baseline indexes intentionally freeze the source definitions at 9006d210;
-- inspect the emitted current catalog before reusing this benchmark later.
-- Models SQL bodies, not installed RPC/auth/RLS/PostgREST/network overhead.
-- Post-warmup synthetic timings are not production latency predictions.
\if :{?kan320_local_fixture}
\else
  \echo 'Set kan320_local_fixture only when using the disposable local database.'
  \quit
\endif

begin;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

select jsonb_build_object('kind', 'environment', 'version', version(),
  'settings', (select jsonb_object_agg(name, setting) from pg_settings
    where name in ('shared_buffers', 'work_mem', 'random_page_cost',
      'seq_page_cost', 'effective_cache_size', 'jit')));
select jsonb_build_object('kind', 'existing_index', 'table', tablename,
  'name', indexname, 'definition', indexdef)
from pg_indexes where schemaname = 'public'
  and tablename in ('helm_records', 'helm_account_state', 'helm_secret_entries')
order by tablename, indexname;

-- LIKE excludes source records, FK/trigger behavior and RLS. No Vault values.
create temporary table kan320_records
  (like public.helm_records including defaults including constraints);
alter table kan320_records add primary key (user_id, collection, record_id);
create index kan320_active_position on kan320_records
  (user_id, collection, position, record_id) where deleted_at is null;
create index kan320_account_version on kan320_records (user_id, account_version);
create temporary table kan320_state
  (like public.helm_account_state including defaults including constraints);
alter table kan320_state add primary key (user_id);
create temporary table kan320_secrets
  (like public.helm_secret_entries including defaults including constraints);
alter table kan320_secrets add primary key (user_id, secret_id);
create unique index kan320_secret_source on kan320_secrets (user_id, source_ref);
create unique index kan320_secret_vault on kan320_secrets (vault_secret_id);
create index kan320_secret_label on kan320_secrets
  (user_id, lower(label), secret_id) where archived_at is null;

-- Accounts 1/2: 2,746 total records and no Activity, a live-count-sized case.
-- The distribution/payloads are invented, not copies of account data.
-- Accounts 3/4: hypothetical growth, exactly 500/5,000 active Activity rows.
insert into kan320_records
  (user_id, collection, record_id, payload, position, account_version,
   created_at, updated_at, deleted_at)
select ('00000000-0000-4000-8000-' || lpad(account::text, 12, '0'))::uuid,
  case when account >= 3 and n % 5 = 0 then 'assistantActivityLog'
       when n % 2 = 0 then 'tasks' else 'inventory' end,
  lpad(n::text, 8, '0'),
  jsonb_build_object('id', lpad(n::text, 8, '0'), 'text', repeat('synthetic-', 24)),
  0, n,
  '2026-09-22T00:00:00Z'::timestamptz + (n / 12) * interval '1 second',
  '2026-09-22T00:00:00Z'::timestamptz + n * interval '1 second',
  case when n % 19 = 0 and not (account >= 3 and n % 5 = 0)
       then '2026-09-23T00:00:00Z'::timestamptz end
from (values (1, 1373), (2, 1373), (3, 2500), (4, 25000)) accounts(account, total)
cross join lateral generate_series(1, total) rows(n);
insert into kan320_state (user_id, account_version)
select user_id, max(account_version) from kan320_records group by user_id;
insert into kan320_secrets
  (user_id, secret_id, label, kind, vault_secret_id, account_version)
select ('00000000-0000-4000-8000-' || lpad(account::text, 12, '0'))::uuid,
  md5(account || '-' || n)::uuid, 'Synthetic ' || n, 'other',
  md5('vault-' || account || '-' || n)::uuid, 1350 + n
from generate_series(1, 2) account cross join generate_series(1, 11) n;
analyze kan320_records;
analyze kan320_state;
analyze kan320_secrets;
select jsonb_build_object('kind', 'fixture_count', 'account', right(user_id::text, 1),
  'collection', collection, 'rows', count(*), 'active', count(*) filter (where deleted_at is null))
from kan320_records group by user_id, collection order by user_id, collection;
select jsonb_build_object('kind', 'secret_count', 'rows', count(*)) from kan320_secrets;

create temporary table kan320_queries (label text primary key, sql text);
-- Same snapshot body/projection as the scoped RPC, with a synthetic caller.
insert into kan320_queries values ('scoped_tasks', $query$
select jsonb_build_object(
  'state', coalesce((select jsonb_build_object(
    'userId', state.user_id, 'schemaVersion', state.schema_version,
    'accountVersion', state.account_version, 'minimumClientVersion', state.minimum_client_version,
    'migratedAt', state.migrated_at, 'updatedAt', state.updated_at)
    from kan320_state state where state.user_id = '00000000-0000-4000-8000-000000000001'),
    jsonb_build_object('userId', '00000000-0000-4000-8000-000000000001',
      'schemaVersion', 1, 'accountVersion', 0, 'minimumClientVersion', '0.2.86',
      'migratedAt', null, 'updatedAt', '1970-01-01T00:00:00.000Z')),
  'records', coalesce((select jsonb_agg(jsonb_build_object(
    'userId', record.user_id, 'collection', record.collection,
    'recordId', record.record_id, 'payload', record.payload,
    'position', record.position, 'revision', record.revision,
    'accountVersion', record.account_version, 'createdAt', record.created_at,
    'updatedAt', record.updated_at, 'deletedAt', record.deleted_at)
    order by record.collection, record.record_id)
    from kan320_records record
    where record.user_id = '00000000-0000-4000-8000-000000000001'
      and record.collection = any(array['tasks']::text[])), '[]'::jsonb))
$query$);
insert into kan320_queries select 'scoped_tasks_inventory',
  replace(sql, 'array[''tasks'']', 'array[''tasks'', ''inventory'']')
from kan320_queries where label = 'scoped_tasks';
insert into kan320_queries select 'scoped_empty',
  replace(sql, 'array[''tasks'']', 'array[]')
from kan320_queries where label = 'scoped_tasks';
insert into kan320_queries values ('changed_recent', $query$
select jsonb_build_object(
  'accountVersion', coalesce((select state.account_version from kan320_state state
    where state.user_id = '00000000-0000-4000-8000-000000000001'), 0),
  'collections', coalesce((select jsonb_agg(changed.collection order by changed.collection)
    from (select distinct record.collection from kan320_records record
      where record.user_id = '00000000-0000-4000-8000-000000000001'
        and record.account_version > 1360) changed), '[]'::jsonb),
  'secretsChanged', exists(select 1 from kan320_secrets secret
    where secret.user_id = '00000000-0000-4000-8000-000000000001'
      and secret.account_version > 1360))
$query$);
insert into kan320_queries select 'changed_none', replace(sql, '> 1360', '> 1373')
from kan320_queries where label = 'changed_recent';
insert into kan320_queries select 'changed_all', replace(sql, '> 1360', '> 0')
from kan320_queries where label = 'changed_recent';
insert into kan320_queries values ('account_version_probe', $query$
select account_version from kan320_state
where user_id = '00000000-0000-4000-8000-000000000001'
$query$);
insert into kan320_queries values ('scoped_fallback_page', $query$
select user_id, collection, record_id, payload, position, revision,
  account_version, created_at, updated_at, deleted_at
from kan320_records
where user_id = '00000000-0000-4000-8000-000000000001'
  and collection in ('tasks', 'inventory')
order by collection, record_id limit 1000 offset 0
$query$), ('scoped_fallback_count', $query$
select count(*) from kan320_records
where user_id = '00000000-0000-4000-8000-000000000001'
  and collection in ('tasks', 'inventory')
$query$), ('generic_position_page', $query$
select user_id, collection, record_id, payload, position, revision,
  account_version, created_at, updated_at, deleted_at
from kan320_records
where user_id = '00000000-0000-4000-8000-000000000001'
  and collection = 'tasks' and deleted_at is null
order by position asc nulls last, record_id asc limit 51 offset 0
$query$);
insert into kan320_queries
select 'activity_' || label || '_offset_' || offset_rows, format($query$
select user_id, collection, record_id, payload, position, revision,
  account_version, created_at, updated_at, deleted_at
from kan320_records
where user_id = %L::uuid and collection = 'assistantActivityLog' and deleted_at is null
order by created_at desc, record_id asc limit 51 offset %s
$query$, '00000000-0000-4000-8000-' || lpad(account::text, 12, '0'), offset_rows)
from (values ('empty', 1, 0), ('500', 3, 0), ('500', 3, 50),
  ('5000', 4, 0), ('5000', 4, 50), ('5000', 4, 2500)) pages(label, account, offset_rows);

create temporary table kan320_results (phase text, label text, execution_ms double precision[], plan jsonb);
create function pg_temp.kan320_measure(p_phase text) returns void language plpgsql as $$
declare q record; p jsonb; timings double precision[]; attempt integer;
begin
  for q in select * from kan320_queries order by label loop
    timings := '{}';
    for attempt in 0..5 loop
      execute 'explain (analyze, buffers, format json) ' || q.sql into p;
      if attempt > 0 then timings := array_append(timings, (p->0->>'Execution Time')::double precision); end if;
    end loop;
    insert into kan320_results values (p_phase, q.label, timings, p->0);
  end loop;
end;
$$;
select pg_temp.kan320_measure('baseline');

-- The sole plausible candidate: ordered Activity pagination, no payload INCLUDE.
-- Kept temporary for comparison; this script makes no schema recommendation.
create index kan320_candidate_activity on kan320_records (user_id, created_at desc, record_id)
where collection = 'assistantActivityLog' and deleted_at is null;
select pg_temp.kan320_measure('candidate_activity');
select jsonb_build_object('kind', 'index_size', 'name', indexrelname,
  'bytes', pg_relation_size(indexrelid))
from pg_stat_all_indexes where relid = 'kan320_records'::regclass order by indexrelname;
select jsonb_build_object('kind', 'table_size', 'heap_bytes', pg_table_size('kan320_records'),
  'total_bytes', pg_total_relation_size('kan320_records'));
select jsonb_build_object('kind', 'measurement', 'phase', phase, 'label', label,
  'execution_ms', execution_ms,
  'median_ms', (select percentile_cont(0.5) within group (order by ms) from unnest(execution_ms) ms),
  'plan', plan)
from kan320_results order by label, phase;
rollback;
