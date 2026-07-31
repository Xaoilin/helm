begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.helm_account_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version > 0),
  account_version bigint not null default 0 check (account_version >= 0),
  minimum_client_version text not null default '0.2.82',
  legacy_manifest jsonb not null default '{}'::jsonb
    check (jsonb_typeof(legacy_manifest) = 'object'),
  migrated_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.helm_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  collection text not null check (collection <> '' and length(collection) <= 64),
  record_id text not null check (record_id <> '' and length(record_id) <= 256),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  position bigint,
  revision bigint not null default 1 check (revision > 0),
  account_version bigint not null default 0 check (account_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint helm_records_pkey primary key (user_id, collection, record_id)
);

create table if not exists public.helm_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  result jsonb,
  applied_at timestamptz not null default now(),
  constraint helm_mutation_receipts_pkey primary key (user_id, request_id)
);

create table if not exists public.helm_legacy_quarantine (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  collection text not null,
  legacy_key text not null,
  reason text not null,
  payload jsonb not null,
  archived_at timestamptz not null default now(),
  constraint helm_legacy_quarantine_unique unique (user_id, collection, legacy_key, reason)
);

create index if not exists helm_records_active_collection_position_idx
  on public.helm_records (user_id, collection, position, record_id)
  where deleted_at is null;

create index if not exists helm_records_account_version_idx
  on public.helm_records (user_id, account_version);

alter table public.helm_account_state enable row level security;
alter table public.helm_records enable row level security;
alter table public.helm_mutation_receipts enable row level security;
alter table public.helm_legacy_quarantine enable row level security;

drop policy if exists "HELM account state is private" on public.helm_account_state;
create policy "HELM account state is private"
on public.helm_account_state
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "HELM records are private" on public.helm_records;
create policy "HELM records are private"
on public.helm_records
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.helm_account_state from public, anon, authenticated;
revoke all on public.helm_records from public, anon, authenticated;
revoke all on public.helm_mutation_receipts from public, anon, authenticated;
revoke all on public.helm_legacy_quarantine from public, anon, authenticated;
grant select on public.helm_account_state to authenticated;
grant select on public.helm_records to authenticated;

create schema if not exists helm_private;
revoke all on schema helm_private from public, anon, authenticated;

create or replace function public.apply_helm_mutations(
  p_request_id uuid,
  p_operations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '3s'
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_operation jsonb;
  v_operation_type text;
  v_collection text;
  v_record_id text;
  v_record public.helm_records%rowtype;
  v_payload jsonb;
  v_set jsonb;
  v_unset_key text;
  v_increment_field text;
  v_increment_amount numeric;
  v_next_version bigint;
  v_claimed boolean;
  v_row_count integer;
  v_ordered_id text;
  v_position bigint;
  v_changes jsonb := '[]'::jsonb;
  v_event_changes jsonb := '[]'::jsonb;
  v_result jsonb;
  v_allowed_collections constant text[] := array[
    'settings', 'integrations', 'conversations',
    'calendarAccounts', 'calendarSources', 'calendarEvents',
    'captureItems', 'clock',
    'trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries',
    'projects', 'projectPages', 'tasks', 'dashboardFocusFeedback',
    'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems', 'healthFastFoodEntries',
    'financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals',
    'gamification', 'prayerTracking', 'assistantCorrections', 'assistantActivityLog'
  ];
begin
  if v_user_id is null then
    raise exception 'A signed-in HELM account is required.' using errcode = '42501';
  end if;
  if coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'Anonymous sessions cannot mutate HELM account data.' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'A mutation request id is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_operations) <> 'array'
    or jsonb_array_length(p_operations) = 0
    or jsonb_array_length(p_operations) > 2000
    or octet_length(p_operations::text) > 4194304 then
    raise exception 'HELM mutations must contain between 1 and 2000 operations and remain under 4 MiB.'
      using errcode = '22023';
  end if;

  insert into public.helm_mutation_receipts (user_id, request_id, result)
  values (v_user_id, p_request_id, null)
  on conflict (user_id, request_id) do nothing
  returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    select result
    into v_result
    from public.helm_mutation_receipts
    where user_id = v_user_id and request_id = p_request_id;
    if v_result is null then
      raise exception 'The matching HELM mutation is still being committed.'
        using errcode = '40001';
    end if;
    return v_result;
  end if;

  insert into public.helm_account_state (
    user_id,
    schema_version,
    account_version,
    minimum_client_version,
    updated_at
  )
  values (v_user_id, 1, 0, '0.2.82', now())
  on conflict (user_id) do nothing;

  select account_version + 1
  into v_next_version
  from public.helm_account_state
  where user_id = v_user_id
  for update;

  for v_operation in
    select value from jsonb_array_elements(p_operations)
  loop
    if jsonb_typeof(v_operation) <> 'object' then
      raise exception 'Every HELM mutation must be an object.' using errcode = '22023';
    end if;
    v_operation_type := v_operation ->> 'op';
    v_collection := v_operation ->> 'collection';
    if v_collection is null or not (v_collection = any(v_allowed_collections)) then
      raise exception 'Unsupported HELM collection.' using errcode = '22023';
    end if;

    if v_operation_type = 'reorder' then
      if jsonb_typeof(v_operation -> 'orderedRecordIds') <> 'array' then
        raise exception 'Reorder mutations require orderedRecordIds.' using errcode = '22023';
      end if;
      for v_ordered_id, v_position in
        select ordered_id, ordinal - 1
        from jsonb_array_elements_text(v_operation -> 'orderedRecordIds')
          with ordinality as ordered(ordered_id, ordinal)
      loop
        update public.helm_records
        set
          position = v_position,
          revision = revision + 1,
          account_version = v_next_version,
          updated_at = now()
        where user_id = v_user_id
          and collection = v_collection
          and record_id = v_ordered_id
          and deleted_at is null
          and position is distinct from v_position;
      end loop;
      continue;
    end if;

    v_record_id := v_operation ->> 'recordId';
    if v_record_id is null or v_record_id = '' or length(v_record_id) > 256 then
      raise exception 'HELM mutations require a bounded recordId.' using errcode = '22023';
    end if;

    if v_operation_type = 'create' then
      v_payload := v_operation -> 'payload';
      if jsonb_typeof(v_payload) <> 'object' then
        raise exception 'Create mutations require an object payload.' using errcode = '22023';
      end if;
      insert into public.helm_records (
        user_id, collection, record_id, payload, position,
        revision, account_version, created_at, updated_at, deleted_at
      )
      values (
        v_user_id,
        v_collection,
        v_record_id,
        v_payload,
        case
          when jsonb_typeof(v_operation -> 'position') = 'number'
            then (v_operation ->> 'position')::bigint
          else null
        end,
        1,
        v_next_version,
        now(),
        now(),
        null
      )
      on conflict (user_id, collection, record_id) do nothing;
      get diagnostics v_row_count = row_count;
      if v_row_count <> 1 then
        raise exception 'A HELM record with this id already exists.' using errcode = '23505';
      end if;

    elsif v_operation_type = 'patch' then
      v_set := coalesce(v_operation -> 'set', '{}'::jsonb);
      if jsonb_typeof(v_set) <> 'object' then
        raise exception 'Patch set must be an object.' using errcode = '22023';
      end if;
      select *
      into v_record
      from public.helm_records
      where user_id = v_user_id
        and collection = v_collection
        and record_id = v_record_id
        and deleted_at is null
      for update;
      if not found then
        raise exception 'The HELM record cannot be patched because it is missing or deleted.'
          using errcode = 'P0002';
      end if;
      v_payload := v_record.payload || v_set;
      if v_operation ? 'unset' then
        if jsonb_typeof(v_operation -> 'unset') <> 'array' then
          raise exception 'Patch unset must be an array.' using errcode = '22023';
        end if;
        for v_unset_key in
          select value from jsonb_array_elements_text(v_operation -> 'unset')
        loop
          v_payload := v_payload - v_unset_key;
        end loop;
      end if;
      update public.helm_records
      set
        payload = v_payload,
        revision = revision + 1,
        account_version = v_next_version,
        updated_at = now()
      where user_id = v_user_id
        and collection = v_collection
        and record_id = v_record_id
        and payload is distinct from v_payload;

    elsif v_operation_type = 'increment' then
      v_increment_field := v_operation ->> 'field';
      v_increment_amount := (v_operation ->> 'amount')::numeric;
      if v_increment_field is null or v_increment_field = '' or v_increment_amount is null then
        raise exception 'Increment mutations require a field and amount.' using errcode = '22023';
      end if;
      select *
      into v_record
      from public.helm_records
      where user_id = v_user_id
        and collection = v_collection
        and record_id = v_record_id
        and deleted_at is null
      for update;
      if not found or jsonb_typeof(v_record.payload -> v_increment_field) <> 'number' then
        raise exception 'The increment target is missing, deleted, or not numeric.' using errcode = '22023';
      end if;
      v_payload := jsonb_set(
        v_record.payload,
        array[v_increment_field],
        to_jsonb(((v_record.payload ->> v_increment_field)::numeric + v_increment_amount)),
        false
      );
      update public.helm_records
      set
        payload = v_payload,
        revision = revision + 1,
        account_version = v_next_version,
        updated_at = now()
      where user_id = v_user_id
        and collection = v_collection
        and record_id = v_record_id;

    elsif v_operation_type = 'delete' then
      update public.helm_records
      set
        deleted_at = now(),
        revision = revision + 1,
        account_version = v_next_version,
        updated_at = now()
      where user_id = v_user_id
        and collection = v_collection
        and record_id = v_record_id
        and deleted_at is null;

    elsif v_operation_type = 'restore' then
      update public.helm_records
      set
        deleted_at = null,
        revision = revision + 1,
        account_version = v_next_version,
        updated_at = now()
      where user_id = v_user_id
        and collection = v_collection
        and record_id = v_record_id
        and deleted_at is not null;

    else
      raise exception 'Unsupported HELM mutation operation.' using errcode = '22023';
    end if;
  end loop;

  update public.helm_account_state
  set
    schema_version = 1,
    account_version = v_next_version,
    minimum_client_version = '0.2.82',
    updated_at = now()
  where user_id = v_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId', user_id,
        'collection', collection,
        'recordId', record_id,
        'payload', payload,
        'position', position,
        'revision', revision,
        'accountVersion', account_version,
        'createdAt', created_at,
        'updatedAt', updated_at,
        'deletedAt', deleted_at
      )
      order by collection, record_id
    ),
    '[]'::jsonb
  )
  into v_changes
  from public.helm_records
  where user_id = v_user_id and account_version = v_next_version;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'collection', collection,
        'recordId', record_id,
        'revision', revision,
        'deletedAt', deleted_at
      )
      order by collection, record_id
    ),
    '[]'::jsonb
  )
  into v_event_changes
  from public.helm_records
  where user_id = v_user_id and account_version = v_next_version;

  v_result := jsonb_build_object(
    'requestId', p_request_id,
    'accountVersion', v_next_version,
    'changes', v_changes
  );

  update public.helm_mutation_receipts
  set result = v_result, applied_at = now()
  where user_id = v_user_id and request_id = p_request_id;

  if jsonb_array_length(v_event_changes) > 0 then
    perform realtime.send(
      jsonb_build_object(
        'requestId', p_request_id,
        'accountVersion', v_next_version,
        'changes', v_event_changes
      ),
      'helm_records_changed',
      'helm:account:' || v_user_id::text,
      true
    );
  end if;

  return v_result;
end;
$$;

revoke execute on function public.apply_helm_mutations(uuid, jsonb) from public, anon;
grant execute on function public.apply_helm_mutations(uuid, jsonb) to authenticated;

drop policy if exists "HELM account broadcasts are private" on realtime.messages;
create policy "HELM account broadcasts are private"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (select realtime.topic()) = 'helm:account:' || (select auth.uid())::text
);

-- Preserve every legacy kv_store row as a read-only rollback source. The
-- migration below only adds normalized account records.
create temporary view helm_authenticated_legacy_kv as
select kv.*
from public.kv_store as kv
join auth.users as account on account.id::text = kv.user_id::text
where kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

insert into public.helm_account_state (
  user_id,
  schema_version,
  account_version,
  minimum_client_version,
  legacy_manifest,
  migrated_at,
  updated_at
)
select
  user_id::text::uuid,
  1,
  1,
  '0.2.82',
  jsonb_build_object(
    'rowCount', count(*),
    'snapshotSha256', encode(extensions.digest(convert_to(
      string_agg(namespace || E'\x1f' || key || E'\x1f' || value::text, E'\x1e'
        order by namespace, key),
      'UTF8'
    ), 'sha256'), 'hex'),
    'stores', jsonb_object_agg(
      namespace || '/' || key,
      jsonb_build_object(
        'valueType', jsonb_typeof(value),
        'recordCount', case
          when jsonb_typeof(value) = 'array' then jsonb_array_length(value)
          else 1
        end,
        'canonicalSha256', encode(extensions.digest(convert_to(value::text, 'UTF8'), 'sha256'), 'hex')
      )
      order by namespace, key
    )
  ),
  now(),
  now()
from helm_authenticated_legacy_kv
group by user_id
on conflict (user_id) do nothing;

-- Malformed, missing-id, and duplicate-id legacy array entries remain outside
-- the active runtime while the untouched kv_store row stays as the full source.
with legacy_items as (
  select
    kv.user_id::text::uuid as user_id,
    kv.key as collection,
    item.value,
    item.ordinal,
    nullif(item.value ->> 'id', '') as record_id,
    count(*) over (
      partition by kv.user_id, kv.key, nullif(item.value ->> 'id', '')
    ) as duplicate_count,
    kv.updated_at
  from helm_authenticated_legacy_kv as kv
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(kv.value) = 'array' then kv.value else '[]'::jsonb end
  ) with ordinality as item(value, ordinal)
  where kv.namespace = 'helm'
    and kv.key = any(array[
      'integrations', 'conversations',
      'calendarAccounts', 'calendarSources', 'calendarEvents',
      'captureItems',
      'trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries',
      'projects', 'projectPages', 'tasks', 'dashboardFocusFeedback',
      'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems', 'healthFastFoodEntries',
      'financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals',
      'assistantCorrections', 'assistantActivityLog'
    ])
    and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
)
insert into public.helm_legacy_quarantine (
  user_id, collection, legacy_key, reason, payload, archived_at
)
select
  user_id,
  collection,
  ordinal::text,
  case
    when jsonb_typeof(value) <> 'object' then 'non_object_record'
    when record_id is null then 'missing_stable_id'
    when length(record_id) > 256 then 'oversized_stable_id'
    else 'duplicate_stable_id'
  end,
  jsonb_build_object('value', value, 'sourceUpdatedAt', updated_at),
  now()
from legacy_items
where jsonb_typeof(value) <> 'object'
  or record_id is null
  or length(record_id) > 256
  or duplicate_count > 1
on conflict (user_id, collection, legacy_key, reason) do nothing;

-- Ordinary array-backed stores become one row per valid stable item id.
insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  kv.key,
  item.value ->> 'id',
  case
    when jsonb_typeof(item.value) = 'object' and kv.key = 'projects'
      then item.value - 'localPath' - 'projectRoot' - 'approvedProfiles' - 'fingerprint' - 'processes' - 'logs'
    when jsonb_typeof(item.value) = 'object' then item.value
    else jsonb_build_object('legacyValue', item.value)
  end,
  item.ordinal - 1,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
cross join lateral (
  select
    candidate.value,
    candidate.ordinal,
    count(*) over (partition by nullif(candidate.value ->> 'id', '')) as duplicate_count
  from jsonb_array_elements(
    case when jsonb_typeof(kv.value) = 'array' then kv.value else '[]'::jsonb end
  ) with ordinality as candidate(value, ordinal)
) as item
where kv.namespace = 'helm'
  and kv.key = any(array[
    'integrations', 'conversations',
    'calendarAccounts', 'calendarSources', 'calendarEvents',
    'captureItems',
    'trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries',
    'projects', 'projectPages', 'tasks', 'dashboardFocusFeedback',
    'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems', 'healthFastFoodEntries',
    'financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals',
    'assistantCorrections', 'assistantActivityLog'
  ])
  and jsonb_typeof(item.value) = 'object'
  and nullif(item.value ->> 'id', '') is not null
  and length(item.value ->> 'id') <= 256
  and item.duplicate_count = 1
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

-- Numeric integration objects may leave active settings only after their
-- proper integration record exists for the same account.
do $$
begin
  if exists (
    select 1
    from helm_authenticated_legacy_kv as kv
    cross join lateral jsonb_each(
      case when jsonb_typeof(kv.value) = 'object' then kv.value else '{}'::jsonb end
    ) as entry
    where kv.namespace = 'helm'
      and kv.key = 'settings'
      and entry.key ~ '^[0-9]+$'
      and jsonb_typeof(entry.value) = 'object'
      and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and not exists (
        select 1
        from public.helm_records as integration
        where integration.user_id = kv.user_id::text::uuid
          and integration.collection = 'integrations'
          and integration.record_id = entry.value ->> 'id'
          and integration.deleted_at is null
      )
  ) then
    raise exception 'Numeric legacy settings cannot be normalized until their integration records are verified.'
      using errcode = '23514';
  end if;
end;
$$;

insert into public.helm_legacy_quarantine (
  user_id, collection, legacy_key, reason, payload, archived_at
)
select
  kv.user_id::text::uuid,
  'settings',
  entry.key,
  'normalized_numeric_integration',
  jsonb_build_object('value', entry.value, 'sourceUpdatedAt', kv.updated_at),
  now()
from helm_authenticated_legacy_kv as kv
cross join lateral jsonb_each(
  case when jsonb_typeof(kv.value) = 'object' then kv.value else '{}'::jsonb end
) as entry
where kv.namespace = 'helm'
  and kv.key = 'settings'
  and entry.key ~ '^[0-9]+$'
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, legacy_key, reason) do nothing;

-- Shared settings are whitelisted; device credentials and retired fields
-- remain recoverable in the untouched legacy kv_store row.
insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  'settings',
  'singleton',
  coalesce(settings.payload, '{}'::jsonb),
  null,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
cross join lateral (
  select jsonb_object_agg(entry.key, entry.value) filter (
    where entry.key = any(array[
      'theme', 'dataRetentionDays', 'telemetry', 'defaultCalendarTab', 'goalTags',
      'prayerEnabled', 'prayerCity', 'prayerCountry',
      'prayerReminderEnabled', 'prayerReminderMinutes',
      'assistantEnabled', 'elevenLabsVoiceId', 'wakeWordEnabled',
      'assistantLanguage', 'assistantProvider', 'hostedModel'
    ])
  ) as payload
  from jsonb_each(case when jsonb_typeof(kv.value) = 'object' then kv.value else '{}'::jsonb end) as entry
) as settings
where kv.namespace = 'helm'
  and kv.key = 'settings'
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

-- Clock aggregates are decomposed into independent timers, stopwatches, and metadata.
insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  'clock',
  'meta',
  jsonb_build_object(
    'nextStopwatchNumber', coalesce(kv.value -> 'nextStopwatchNumber', '1'::jsonb),
    'nextTimerNumber', coalesce(kv.value -> 'nextTimerNumber', '1'::jsonb)
  ),
  null,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
where kv.namespace = 'helm' and kv.key = 'clock'
  and jsonb_typeof(kv.value) = 'object'
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  'clock',
  kind.prefix || (item.value ->> 'id'),
  item.value,
  item.ordinal - 1,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
cross join lateral (
  values ('stopwatch:', 'stopwatches'), ('timer:', 'timers')
) as kind(prefix, field_name)
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(kv.value -> kind.field_name) = 'array'
    then kv.value -> kind.field_name else '[]'::jsonb end
) with ordinality as item(value, ordinal)
where kv.namespace = 'helm' and kv.key = 'clock'
  and jsonb_typeof(item.value) = 'object'
  and nullif(item.value ->> 'id', '') is not null
  and length(item.value ->> 'id') <= 246
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

-- Gamification counters and ledgers become independently mergeable records.
insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  'gamification',
  'profile',
  kv.value - 'habitTallies' - 'dailyLog' - 'prayerCompletionLedger',
  null,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
where kv.namespace = 'helm' and kv.key = 'gamification'
  and jsonb_typeof(kv.value) = 'object'
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  'gamification',
  map_kind.prefix || entry.key,
  case map_kind.field_name
    when 'habitTallies' then jsonb_build_object('count', entry.value)
    when 'dailyLog' then jsonb_build_object('taskIds', entry.value)
    else entry.value
  end,
  null,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
cross join lateral (
  values
    ('habit:', 'habitTallies'),
    ('day:', 'dailyLog'),
    ('prayer:', 'prayerCompletionLedger')
) as map_kind(prefix, field_name)
cross join lateral jsonb_each(
  case when jsonb_typeof(kv.value -> map_kind.field_name) = 'object'
    then kv.value -> map_kind.field_name else '{}'::jsonb end
) as entry
where kv.namespace = 'helm' and kv.key = 'gamification'
  and (
    (map_kind.field_name = 'habitTallies' and jsonb_typeof(entry.value) = 'number')
    or (map_kind.field_name = 'dailyLog' and jsonb_typeof(entry.value) = 'array')
    or (map_kind.field_name = 'prayerCompletionLedger' and jsonb_typeof(entry.value) = 'object')
  )
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

-- Prayer outcomes and reminder receipts are independent records.
insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  'prayerTracking',
  'meta',
  jsonb_build_object(
    'schemaVersion', coalesce(kv.value -> 'schemaVersion', '1'::jsonb),
    'trackingStartedAt', coalesce(kv.value -> 'trackingStartedAt', to_jsonb(kv.updated_at))
  ),
  null,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
where kv.namespace = 'helm' and kv.key = 'prayerTracking'
  and jsonb_typeof(kv.value) = 'object'
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  'prayerTracking',
  'activation',
  kv.value -> 'activationDayEligibility',
  null,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
where kv.namespace = 'helm' and kv.key = 'prayerTracking'
  and jsonb_typeof(kv.value -> 'activationDayEligibility') = 'object'
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

insert into public.helm_records (
  user_id, collection, record_id, payload, position,
  revision, account_version, created_at, updated_at
)
select
  kv.user_id::text::uuid,
  'prayerTracking',
  map_kind.prefix || entry.key,
  entry.value,
  null,
  1,
  1,
  kv.updated_at,
  kv.updated_at
from helm_authenticated_legacy_kv as kv
cross join lateral (
  values ('record:', 'records'), ('reminder:', 'reminderReceipts')
) as map_kind(prefix, field_name)
cross join lateral jsonb_each(
  case when jsonb_typeof(kv.value -> map_kind.field_name) = 'object'
    then kv.value -> map_kind.field_name else '{}'::jsonb end
) as entry
where kv.namespace = 'helm' and kv.key = 'prayerTracking'
  and jsonb_typeof(entry.value) = 'object'
  and kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (user_id, collection, record_id) do nothing;

-- Every future authenticated account receives an empty authoritative state at
-- account creation, so first sign-in never needs a local fallback or bootstrap
-- write. Existing auth users without legacy rows are backfilled below.
create or replace function helm_private.initialize_account_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.helm_account_state (
    user_id, schema_version, account_version, minimum_client_version, updated_at
  )
  values (new.id, 1, 0, '0.2.82', now())
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function helm_private.initialize_account_state() from public, anon, authenticated;

drop trigger if exists helm_initialize_account_state on auth.users;
create trigger helm_initialize_account_state
after insert on auth.users
for each row execute function helm_private.initialize_account_state();

insert into public.helm_account_state (
  user_id, schema_version, account_version, minimum_client_version, updated_at
)
select id, 1, 0, '0.2.82', now()
from auth.users
on conflict (user_id) do nothing;

-- Old clients may still read the rollback snapshot, but cannot overwrite it.
revoke insert, update, delete, truncate on public.kv_store from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'kv_store'
  ) then
    alter publication supabase_realtime drop table public.kv_store;
  end if;
end;
$$;

commit;
