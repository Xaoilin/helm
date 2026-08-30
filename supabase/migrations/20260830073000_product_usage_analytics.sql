begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists helm_private;
revoke all on schema helm_private from public, anon, authenticated;

create or replace function helm_private.product_usage_metadata_is_safe(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object'
    and octet_length(coalesce(p_metadata, '{}'::jsonb)::text) <= 2048
    and not exists (
      select 1
      from jsonb_each(coalesce(p_metadata, '{}'::jsonb)) as entry(key, value)
      where entry.key <> all(array[
        'previousSurface', 'navigationSource', 'viewportBucket',
        'visibilityState', 'retryCount'
      ])
        or jsonb_typeof(entry.value) not in ('string', 'number', 'boolean', 'null')
        or (jsonb_typeof(entry.value) = 'string' and length(entry.value #>> '{}') > 96)
    );
$$;

revoke all on function helm_private.product_usage_metadata_is_safe(jsonb)
  from public, anon, authenticated;

create table if not exists public.product_usage_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  schema_version smallint not null check (schema_version = 1),
  session_id uuid not null,
  sequence integer not null check (sequence between 1 and 1000000),
  event_kind text not null check (event_kind = any(array[
    'session', 'navigation', 'action', 'outcome', 'error', 'performance'
  ])),
  occurred_at timestamptz not null,
  surface text check (surface is null or surface = any(array[
    'dashboard', 'chat', 'calendar', 'clock', 'trips', 'projects', 'inventory',
    'secrets', 'tasks', 'employment', 'finance', 'health', 'knowledge', 'profile',
    'integrations', 'activity', 'settings', 'debug'
  ])),
  feature text not null check (feature ~ '^[a-z][a-z0-9_]{0,63}$'),
  action text not null check (action ~ '^[a-z][a-z0-9_]{0,63}$'),
  outcome text check (outcome is null or outcome = any(array[
    'success', 'failure', 'cancelled', 'unavailable'
  ])),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 1800000),
  error_code text check (
    error_code is null or error_code ~ '^[a-z][a-z0-9_:-]{0,63}$'
  ),
  target text check (target is null or target ~ '^[a-z][a-z0-9_:-]{0,95}$'),
  release_version text not null check (
    release_version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][a-zA-Z0-9.-]+)?$'
    and length(release_version) <= 32
  ),
  device_class text not null check (device_class = any(array['mobile', 'tablet', 'desktop'])),
  input_kind text not null check (input_kind = any(array[
    'pointer', 'keyboard', 'voice', 'assistant', 'system'
  ])),
  online boolean not null,
  reduced_motion boolean not null,
  metadata jsonb not null default '{}'::jsonb
    check (helm_private.product_usage_metadata_is_safe(metadata)),
  received_at timestamptz not null default now(),
  constraint product_usage_events_owner_event_unique unique (user_id, event_id),
  constraint product_usage_events_owner_session_sequence_unique unique (
    user_id, session_id, sequence
  )
);

create index if not exists product_usage_events_owner_time_idx
  on public.product_usage_events (user_id, occurred_at desc, event_id);
create index if not exists product_usage_events_owner_feature_idx
  on public.product_usage_events (user_id, feature, action, occurred_at desc);
create index if not exists product_usage_events_owner_kind_idx
  on public.product_usage_events (user_id, event_kind, occurred_at desc);

alter table public.product_usage_events enable row level security;

drop policy if exists "Owners can read private product usage" on public.product_usage_events;
create policy "Owners can read private product usage"
on public.product_usage_events for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.product_usage_events from public, anon, authenticated;
grant select on table public.product_usage_events to authenticated;

create or replace function public.ingest_product_usage_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_event jsonb;
  v_metadata jsonb;
  v_count integer;
  v_accepted integer := 0;
  v_inserted integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'A signed-in Sabah One account is required.';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception using errcode = '22023', message = 'Product usage events must be a JSON array.';
  end if;

  v_count := jsonb_array_length(p_events);
  if v_count < 1 or v_count > 25 then
    raise exception using errcode = '22023', message = 'Product usage batches must contain between 1 and 25 events.';
  end if;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    if jsonb_typeof(v_event) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_event) as key_name
        where key_name <> all(array[
          'eventId', 'schemaVersion', 'sessionId', 'sequence', 'kind', 'occurredAt',
          'surface', 'feature', 'action', 'outcome', 'durationMs', 'errorCode',
          'target', 'releaseVersion', 'deviceClass', 'inputKind', 'online',
          'reducedMotion', 'metadata'
        ])
      )
    then
      raise exception using errcode = '22023',
        message = 'Product usage events contain unsupported fields.';
    end if;

    v_metadata := coalesce(v_event -> 'metadata', '{}'::jsonb);
    if not helm_private.product_usage_metadata_is_safe(v_metadata) then
      raise exception using errcode = '22023',
        message = 'Product usage metadata must use the content-free allowlist.';
    end if;

    if coalesce((v_event ->> 'schemaVersion')::integer, 0) <> 1
      or coalesce((v_event ->> 'sequence')::integer, 0) not between 1 and 1000000
      or coalesce(v_event ->> 'kind', '') <> all(array[
        'session', 'navigation', 'action', 'outcome', 'error', 'performance'
      ])
      or coalesce(v_event ->> 'feature', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(v_event ->> 'action', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(v_event ->> 'releaseVersion', '') !~
        '^[0-9]+\.[0-9]+\.[0-9]+([+-][a-zA-Z0-9.-]+)?$'
      or coalesce(v_event ->> 'deviceClass', '') <> all(array['mobile', 'tablet', 'desktop'])
      or coalesce(v_event ->> 'inputKind', '') <> all(array[
        'pointer', 'keyboard', 'voice', 'assistant', 'system'
      ])
      or jsonb_typeof(v_event -> 'online') <> 'boolean'
      or jsonb_typeof(v_event -> 'reducedMotion') <> 'boolean'
    then
      raise exception using errcode = '22023', message = 'Product usage event taxonomy is invalid.';
    end if;

    if (v_event ? 'surface') and (v_event ->> 'surface') is not null
      and (v_event ->> 'surface') <> all(array[
        'dashboard', 'chat', 'calendar', 'clock', 'trips', 'projects', 'inventory',
        'secrets', 'tasks', 'employment', 'finance', 'health', 'knowledge', 'profile',
        'integrations', 'activity', 'settings', 'debug'
      ])
    then
      raise exception using errcode = '22023', message = 'Product usage surface is invalid.';
    end if;
    if (v_event ? 'outcome') and (v_event ->> 'outcome') is not null
      and (v_event ->> 'outcome') <> all(array['success', 'failure', 'cancelled', 'unavailable'])
    then
      raise exception using errcode = '22023', message = 'Product usage outcome is invalid.';
    end if;
    if (v_event ? 'durationMs') and (v_event ->> 'durationMs') is not null
      and (v_event ->> 'durationMs')::integer not between 0 and 1800000
    then
      raise exception using errcode = '22023', message = 'Product usage duration is invalid.';
    end if;
    if (v_event ? 'errorCode') and (v_event ->> 'errorCode') is not null
      and (v_event ->> 'errorCode') !~ '^[a-z][a-z0-9_:-]{0,63}$'
    then
      raise exception using errcode = '22023', message = 'Product usage error code is invalid.';
    end if;
    if (v_event ? 'target') and (v_event ->> 'target') is not null
      and (v_event ->> 'target') !~ '^[a-z][a-z0-9_:-]{0,95}$'
    then
      raise exception using errcode = '22023', message = 'Product usage target is invalid.';
    end if;

    begin
      insert into public.product_usage_events (
        user_id, event_id, schema_version, session_id, sequence, event_kind,
        occurred_at, surface, feature, action, outcome, duration_ms, error_code,
        target, release_version, device_class, input_kind, online,
        reduced_motion, metadata
      ) values (
        v_user_id,
        (v_event ->> 'eventId')::uuid,
        (v_event ->> 'schemaVersion')::smallint,
        (v_event ->> 'sessionId')::uuid,
        (v_event ->> 'sequence')::integer,
        v_event ->> 'kind',
        (v_event ->> 'occurredAt')::timestamptz,
        nullif(v_event ->> 'surface', ''),
        v_event ->> 'feature',
        v_event ->> 'action',
        nullif(v_event ->> 'outcome', ''),
        case when v_event ? 'durationMs' then (v_event ->> 'durationMs')::integer end,
        nullif(v_event ->> 'errorCode', ''),
        nullif(v_event ->> 'target', ''),
        v_event ->> 'releaseVersion',
        v_event ->> 'deviceClass',
        v_event ->> 'inputKind',
        (v_event ->> 'online')::boolean,
        (v_event ->> 'reducedMotion')::boolean,
        v_metadata
      )
      on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_accepted := v_accepted + v_inserted;
    exception
      when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'Product usage event values are invalid.';
    end;
  end loop;

  return jsonb_build_object(
    'accepted', v_accepted,
    'duplicates', v_count - v_accepted
  );
end;
$$;

revoke all on function public.ingest_product_usage_events(jsonb) from public, anon;
grant execute on function public.ingest_product_usage_events(jsonb) to authenticated;

comment on table public.product_usage_events is
  'Private owner-only Sabah One product events. Typed content-free analytics only; never Life Hero evidence.';
comment on function public.ingest_product_usage_events(jsonb) is
  'Bounded idempotent analytics ingest. Derives owner from auth.uid and rejects content-bearing fields.';

commit;
