begin;

create table public.helm_inventory_oauth_clients (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (client_id = btrim(client_id) and length(client_id) between 1 and 512),
  client_name text not null check (client_name = btrim(client_name) and length(client_name) between 1 and 160),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint helm_inventory_oauth_clients_pkey primary key (user_id, client_id)
);

create table public.helm_inventory_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  action text not null check (length(action) between 1 and 64),
  result jsonb,
  applied_at timestamptz not null default now(),
  constraint helm_inventory_mutation_receipts_pkey primary key (user_id, request_id)
);

create index helm_inventory_oauth_clients_active_idx
  on public.helm_inventory_oauth_clients (user_id, client_id)
  where revoked_at is null;

alter table public.helm_inventory_oauth_clients enable row level security;
alter table public.helm_inventory_mutation_receipts enable row level security;
revoke all on public.helm_inventory_oauth_clients from public, anon, authenticated;
revoke all on public.helm_inventory_mutation_receipts from public, anon, authenticated;

create or replace function helm_private.assert_direct_sabah_one_session()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if nullif((select auth.jwt() ->> 'client_id'), '') is not null then
    raise exception 'OAuth clients cannot use this Sabah One interface.' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

create or replace function helm_private.inventory_client_is_approved(
  p_user_id uuid,
  p_client_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.helm_inventory_oauth_clients as client
    where client.user_id = p_user_id
      and client.client_id = p_client_id
      and client.revoked_at is null
  )
$$;

create or replace function helm_private.require_inventory_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id text := nullif((select auth.jwt() ->> 'client_id'), '');
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if v_client_id is not null
    and not helm_private.inventory_client_is_approved(v_user_id, v_client_id) then
    raise exception 'This OAuth client is not approved for Sabah One Inventory.' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

revoke execute on function helm_private.assert_direct_sabah_one_session() from public, anon, authenticated;
revoke execute on function helm_private.inventory_client_is_approved(uuid, text) from public, anon, authenticated;
revoke execute on function helm_private.require_inventory_actor() from public, anon, authenticated;
-- RLS evaluates this helper by OID for authenticated callers. The private
-- schema itself remains unavailable, so it is not a callable public API.
grant execute on function helm_private.inventory_client_is_approved(uuid, text) to authenticated;

drop policy if exists "HELM account state is private" on public.helm_account_state;
create policy "Sabah One account state is first party"
on public.helm_account_state
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and nullif((select auth.jwt() ->> 'client_id'), '') is null
);

drop policy if exists "HELM records are private" on public.helm_records;
create policy "Sabah One records respect OAuth inventory boundary"
on public.helm_records
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and (
    nullif((select auth.jwt() ->> 'client_id'), '') is null
    or (
      collection = any(array['inventoryItems', 'inventoryNeeds'])
      and helm_private.inventory_client_is_approved(
        user_id,
        nullif((select auth.jwt() ->> 'client_id'), '')
      )
    )
  )
);

create policy "Inventory OAuth approvals are first party"
on public.helm_inventory_oauth_clients
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and nullif((select auth.jwt() ->> 'client_id'), '') is null
);

create or replace function helm_private.validate_inventory_text_array(
  p_value jsonb,
  p_label text,
  p_max_count integer,
  p_max_length integer
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_text text;
begin
  if jsonb_typeof(p_value) <> 'array'
    or jsonb_array_length(p_value) > p_max_count then
    raise exception '% must be an array with at most % values.', p_label, p_max_count using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_value)
  loop
    if jsonb_typeof(v_entry) <> 'string' then
      raise exception '% values must be strings.', p_label using errcode = '22023';
    end if;
    v_text := v_entry #>> '{}';
    if v_text <> btrim(v_text) or length(v_text) not between 1 and p_max_length then
      raise exception '% values must contain 1 to % trimmed characters.', p_label, p_max_length using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function helm_private.validate_inventory_specifications(p_value jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer;
  v_key text;
  v_value jsonb;
  v_text text;
begin
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'Inventory specifications must be an object.' using errcode = '22023';
  end if;
  select count(*) into v_count from jsonb_object_keys(p_value);
  if v_count > 30 then
    raise exception 'Inventory specifications may contain at most 30 fields.' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_value)
  loop
    if v_key <> btrim(v_key) or length(v_key) not between 1 and 60
      or jsonb_typeof(v_value) <> 'string' then
      raise exception 'Inventory specification names and values are invalid.' using errcode = '22023';
    end if;
    v_text := v_value #>> '{}';
    if v_text <> btrim(v_text) or length(v_text) not between 1 and 200 then
      raise exception 'Inventory specification values must contain 1 to 200 trimmed characters.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function helm_private.validate_inventory_payload(
  p_collection text,
  p_record_id text,
  p_payload jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_name text;
  v_unit text;
  v_number numeric;
  v_status text;
  v_allowed_item_keys constant text[] := array[
    'id', 'name', 'category', 'trackingMode', 'quantity', 'unit',
    'lowStockThreshold', 'brand', 'model', 'specifications', 'condition',
    'location', 'tags', 'notes', 'projectCatalogKeys', 'lastVerifiedAt',
    'archivedAt', 'createdAt', 'updatedAt'
  ];
  v_allowed_need_keys constant text[] := array[
    'id', 'name', 'linkedItemId', 'projectCatalogKey', 'requiredQuantity',
    'unit', 'specifications', 'priority', 'status', 'notes', 'orderedAt',
    'acquiredAt', 'dismissedAt', 'createdAt', 'updatedAt'
  ];
begin
  if jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'id' is distinct from p_record_id then
    raise exception 'Inventory payload id must match its stable record id.' using errcode = '22023';
  end if;

  v_name := p_payload ->> 'name';
  v_unit := p_payload ->> 'unit';
  if jsonb_typeof(p_payload -> 'name') <> 'string'
    or v_name <> btrim(v_name) or length(v_name) not between 1 and 160
    or jsonb_typeof(p_payload -> 'unit') <> 'string'
    or v_unit <> btrim(v_unit) or length(v_unit) not between 1 and 32 then
    raise exception 'Inventory names and units must be bounded trimmed text.' using errcode = '22023';
  end if;

  if p_collection = 'inventoryItems' then
    for v_key in select jsonb_object_keys(p_payload)
    loop
      if not (v_key = any(v_allowed_item_keys)) then
        raise exception 'Unsupported Inventory item field: %.', v_key using errcode = '22023';
      end if;
    end loop;
    if not ((p_payload ->> 'category') = any(array[
      'machine', 'tool', 'electronics', 'component', 'material',
      'consumable', 'fastener', 'safety', 'storage', 'other'
    ])) or not ((p_payload ->> 'trackingMode') = any(array['durable', 'counted', 'measured']))
      or not ((p_payload ->> 'condition') = any(array['unknown', 'new', 'good', 'worn', 'needs_repair'])) then
      raise exception 'Inventory item category, tracking mode, or condition is invalid.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_payload -> 'quantity') <> 'number' then
      raise exception 'Inventory item quantity must be numeric.' using errcode = '22023';
    end if;
    v_number := (p_payload ->> 'quantity')::numeric;
    if v_number < 0 or v_number > 1000000000 then
      raise exception 'Inventory item quantity must be between 0 and 1000000000.' using errcode = '22023';
    end if;
    if p_payload ? 'lowStockThreshold' then
      if jsonb_typeof(p_payload -> 'lowStockThreshold') <> 'number'
        or (p_payload ->> 'lowStockThreshold')::numeric < 0
        or (p_payload ->> 'lowStockThreshold')::numeric > 1000000000 then
        raise exception 'Inventory low-stock threshold is invalid.' using errcode = '22023';
      end if;
    end if;
    perform helm_private.validate_inventory_text_array(p_payload -> 'tags', 'Inventory tags', 25, 50);
    perform helm_private.validate_inventory_text_array(p_payload -> 'projectCatalogKeys', 'Inventory project links', 25, 160);
  elsif p_collection = 'inventoryNeeds' then
    for v_key in select jsonb_object_keys(p_payload)
    loop
      if not (v_key = any(v_allowed_need_keys)) then
        raise exception 'Unsupported Inventory need field: %.', v_key using errcode = '22023';
      end if;
    end loop;
    if not ((p_payload ->> 'priority') = any(array['low', 'normal', 'high']))
      or not ((p_payload ->> 'status') = any(array['needed', 'ordered', 'acquired', 'dismissed'])) then
      raise exception 'Inventory need priority or status is invalid.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_payload -> 'requiredQuantity') <> 'number' then
      raise exception 'Inventory required quantity must be numeric.' using errcode = '22023';
    end if;
    v_number := (p_payload ->> 'requiredQuantity')::numeric;
    if v_number < 0 or v_number > 1000000000 then
      raise exception 'Inventory required quantity must be between 0 and 1000000000.' using errcode = '22023';
    end if;
    v_status := p_payload ->> 'status';
    if (v_status = 'ordered' and jsonb_typeof(p_payload -> 'orderedAt') <> 'string')
      or (v_status = 'acquired' and jsonb_typeof(p_payload -> 'acquiredAt') <> 'string')
      or (v_status = 'dismissed' and jsonb_typeof(p_payload -> 'dismissedAt') <> 'string') then
      raise exception 'Inventory need lifecycle timestamp is missing.' using errcode = '22023';
    end if;
  else
    raise exception 'Unsupported Inventory collection.' using errcode = '22023';
  end if;

  perform helm_private.validate_inventory_specifications(p_payload -> 'specifications');
  if jsonb_typeof(p_payload -> 'notes') <> 'string'
    or length(p_payload ->> 'notes') > 4000 then
    raise exception 'Inventory notes must remain under 4000 characters.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'createdAt') <> 'string'
    or length(p_payload ->> 'createdAt') > 64
    or jsonb_typeof(p_payload -> 'updatedAt') <> 'string'
    or length(p_payload ->> 'updatedAt') > 64 then
    raise exception 'Inventory lifecycle timestamps are invalid.' using errcode = '22023';
  end if;

  for v_key in select unnest(array[
    'brand', 'model', 'location', 'linkedItemId', 'projectCatalogKey',
    'lastVerifiedAt', 'archivedAt', 'orderedAt', 'acquiredAt', 'dismissedAt'
  ])
  loop
    if p_payload ? v_key and (
      jsonb_typeof(p_payload -> v_key) <> 'string'
      or length(p_payload ->> v_key) not between 1 and case
        when v_key in ('brand', 'model') then 120
        when v_key in ('location', 'projectCatalogKey') then 160
        when v_key = 'linkedItemId' then 256
        else 64
      end
    ) then
      raise exception 'Inventory optional field % is invalid.', v_key using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke execute on function helm_private.validate_inventory_text_array(jsonb, text, integer, integer) from public, anon, authenticated;
revoke execute on function helm_private.validate_inventory_specifications(jsonb) from public, anon, authenticated;
revoke execute on function helm_private.validate_inventory_payload(text, text, jsonb) from public, anon, authenticated;

-- Existing captures are preserved as recoverable tombstones. They cannot be
-- restored or written through any active Sabah One interface after this point.
update public.helm_records
set
  payload = payload || jsonb_build_object(
    'legacyLifecycle', 'recoverable_tombstone',
    'retiredAt', now()
  ),
  deleted_at = coalesce(deleted_at, now()),
  revision = revision + 1,
  updated_at = now()
where collection = 'captureItems';

create or replace function helm_private.validate_sabah_one_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.collection = 'captureItems' and new.deleted_at is null then
    raise exception 'The legacy Capture Inbox collection is retired.' using errcode = '42501';
  end if;
  if new.collection = any(array['inventoryItems', 'inventoryNeeds'])
    and new.deleted_at is null then
    perform helm_private.validate_inventory_payload(new.collection, new.record_id, new.payload);
  end if;
  return new;
end;
$$;

revoke execute on function helm_private.validate_sabah_one_record() from public, anon, authenticated;
drop trigger if exists helm_validate_sabah_one_record on public.helm_records;
create trigger helm_validate_sabah_one_record
before insert or update of collection, record_id, payload, deleted_at
on public.helm_records
for each row execute function helm_private.validate_sabah_one_record();

-- Preserve the established public RPC name for the first-party app while
-- moving its broad implementation behind an OAuth-denying wrapper.
alter function public.apply_helm_mutations(uuid, jsonb) set schema helm_private;
alter function helm_private.apply_helm_mutations(uuid, jsonb) rename to apply_helm_mutations_direct;
revoke execute on function helm_private.apply_helm_mutations_direct(uuid, jsonb) from public, anon, authenticated;

create function public.apply_helm_mutations(p_request_id uuid, p_operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation jsonb;
  v_collection text;
begin
  perform helm_private.assert_direct_sabah_one_session();
  if jsonb_typeof(p_operations) <> 'array' then
    raise exception 'Sabah One mutations must be an array.' using errcode = '22023';
  end if;
  for v_operation in select value from jsonb_array_elements(p_operations)
  loop
    v_collection := v_operation ->> 'collection';
    if v_collection = 'captureItems' then
      raise exception 'The legacy Capture Inbox collection is retired.' using errcode = '42501';
    end if;
    if v_collection = any(array['inventoryItems', 'inventoryNeeds']) then
      raise exception 'Inventory mutations must use the bounded Inventory interface.' using errcode = '42501';
    end if;
  end loop;
  return helm_private.apply_helm_mutations_direct(p_request_id, p_operations);
end;
$$;

revoke all on function public.apply_helm_mutations(uuid, jsonb) from public, anon;
grant execute on function public.apply_helm_mutations(uuid, jsonb) to authenticated;

create or replace function helm_private.apply_inventory_mutations(
  p_user_id uuid,
  p_request_id uuid,
  p_action text,
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
  v_operation jsonb;
  v_type text;
  v_collection text;
  v_record_id text;
  v_record public.helm_records%rowtype;
  v_need public.helm_records%rowtype;
  v_payload jsonb;
  v_set jsonb;
  v_unset_key text;
  v_field text;
  v_amount numeric;
  v_next_version bigint;
  v_claimed boolean;
  v_existing_action text;
  v_result jsonb;
  v_changes jsonb;
  v_event_changes jsonb;
  v_ordered_id text;
  v_position bigint;
  v_row_count integer;
  v_linked_item_id text;
  v_new_item_id text;
  v_item_found boolean;
  v_now timestamptz := now();
begin
  if p_user_id is null or p_request_id is null
    or p_action is null or length(p_action) not between 1 and 64
    or jsonb_typeof(p_operations) <> 'array'
    or jsonb_array_length(p_operations) = 0
    or jsonb_array_length(p_operations) > 500
    or octet_length(p_operations::text) > 1048576 then
    raise exception 'Inventory mutation request is invalid or exceeds its bounds.' using errcode = '22023';
  end if;

  insert into public.helm_inventory_mutation_receipts (user_id, request_id, action, result)
  values (p_user_id, p_request_id, p_action, null)
  on conflict (user_id, request_id) do nothing
  returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    select action, result into v_existing_action, v_result
    from public.helm_inventory_mutation_receipts
    where user_id = p_user_id and request_id = p_request_id;
    if v_existing_action is distinct from p_action then
      raise exception 'Inventory idempotency key was reused for another action.' using errcode = '22023';
    end if;
    if v_result is null then
      raise exception 'The matching Inventory mutation is still being committed.' using errcode = '40001';
    end if;
    return v_result;
  end if;

  insert into public.helm_account_state (user_id, schema_version, account_version, minimum_client_version, updated_at)
  values (p_user_id, 1, 0, '0.2.86', v_now)
  on conflict (user_id) do nothing;
  select account_version + 1 into v_next_version
  from public.helm_account_state where user_id = p_user_id for update;

  for v_operation in select value from jsonb_array_elements(p_operations)
  loop
    if jsonb_typeof(v_operation) <> 'object' then
      raise exception 'Every Inventory mutation must be an object.' using errcode = '22023';
    end if;
    v_type := v_operation ->> 'op';
    v_collection := v_operation ->> 'collection';
    if not (v_collection = any(array['inventoryItems', 'inventoryNeeds'])) then
      raise exception 'Inventory mutations cannot access another collection.' using errcode = '42501';
    end if;

    if v_type = 'acquire_need' then
      if p_action <> 'complete_need' or v_collection <> 'inventoryNeeds' then
        raise exception 'Acquire operations are restricted to need completion.' using errcode = '42501';
      end if;
      v_record_id := v_operation ->> 'recordId';
      v_new_item_id := v_operation ->> 'newItemId';
      select * into v_need from public.helm_records
      where user_id = p_user_id and collection = 'inventoryNeeds'
        and record_id = v_record_id and deleted_at is null
      for update;
      if not found or not ((v_need.payload ->> 'status') = any(array['needed', 'ordered'])) then
        raise exception 'The Inventory need is unavailable or already closed.' using errcode = 'P0002';
      end if;
      v_linked_item_id := nullif(v_need.payload ->> 'linkedItemId', '');
      v_item_found := false;
      if v_linked_item_id is not null then
        select * into v_record from public.helm_records
        where user_id = p_user_id and collection = 'inventoryItems'
          and record_id = v_linked_item_id and deleted_at is null
          and not (payload ? 'archivedAt')
        for update;
        v_item_found := found;
      end if;
      if v_item_found then
        if lower(v_record.payload ->> 'unit') <> lower(v_need.payload ->> 'unit') then
          raise exception 'The linked item unit does not match the need unit.' using errcode = '22023';
        end if;
        v_payload := v_record.payload || jsonb_build_object(
          'quantity', (v_record.payload ->> 'quantity')::numeric + (v_need.payload ->> 'requiredQuantity')::numeric,
          'lastVerifiedAt', v_now,
          'updatedAt', v_now
        );
        update public.helm_records set payload = v_payload, revision = revision + 1,
          account_version = v_next_version, updated_at = v_now
        where user_id = p_user_id and collection = 'inventoryItems' and record_id = v_record.record_id;
      else
        if v_new_item_id is null or v_new_item_id = '' or length(v_new_item_id) > 256 then
          raise exception 'A stable new item id is required for an unlinked need.' using errcode = '22023';
        end if;
        v_linked_item_id := v_new_item_id;
        v_payload := jsonb_build_object(
          'id', v_new_item_id,
          'name', v_need.payload ->> 'name',
          'category', 'other',
          'trackingMode', 'counted',
          'quantity', (v_need.payload ->> 'requiredQuantity')::numeric,
          'unit', v_need.payload ->> 'unit',
          'specifications', coalesce(v_need.payload -> 'specifications', '{}'::jsonb),
          'condition', 'new',
          'tags', '[]'::jsonb,
          'notes', coalesce(v_need.payload ->> 'notes', ''),
          'projectCatalogKeys', case
            when nullif(v_need.payload ->> 'projectCatalogKey', '') is null then '[]'::jsonb
            else jsonb_build_array(v_need.payload ->> 'projectCatalogKey')
          end,
          'lastVerifiedAt', v_now,
          'createdAt', v_now,
          'updatedAt', v_now
        );
        insert into public.helm_records (
          user_id, collection, record_id, payload, position, revision,
          account_version, created_at, updated_at, deleted_at
        ) values (
          p_user_id, 'inventoryItems', v_new_item_id, v_payload, null, 1,
          v_next_version, v_now, v_now, null
        );
      end if;
      v_payload := v_need.payload || jsonb_build_object(
        'linkedItemId', v_linked_item_id,
        'status', 'acquired',
        'acquiredAt', v_now,
        'updatedAt', v_now
      );
      update public.helm_records set payload = v_payload, revision = revision + 1,
        account_version = v_next_version, updated_at = v_now
      where user_id = p_user_id and collection = 'inventoryNeeds' and record_id = v_need.record_id;
      continue;
    end if;

    if v_type = 'reorder' then
      if jsonb_typeof(v_operation -> 'orderedRecordIds') <> 'array' then
        raise exception 'Inventory reorder requires orderedRecordIds.' using errcode = '22023';
      end if;
      for v_ordered_id, v_position in
        select ordered_id, ordinal - 1
        from jsonb_array_elements_text(v_operation -> 'orderedRecordIds')
          with ordinality as ordered(ordered_id, ordinal)
      loop
        update public.helm_records set position = v_position, revision = revision + 1,
          account_version = v_next_version, updated_at = v_now
        where user_id = p_user_id and collection = v_collection
          and record_id = v_ordered_id and deleted_at is null
          and position is distinct from v_position;
      end loop;
      continue;
    end if;

    v_record_id := v_operation ->> 'recordId';
    if v_record_id is null or v_record_id = '' or length(v_record_id) > 256 then
      raise exception 'Inventory mutations require a bounded record id.' using errcode = '22023';
    end if;

    if v_type = 'create' then
      v_payload := v_operation -> 'payload';
      perform helm_private.validate_inventory_payload(v_collection, v_record_id, v_payload);
      insert into public.helm_records (
        user_id, collection, record_id, payload, position, revision,
        account_version, created_at, updated_at, deleted_at
      ) values (
        p_user_id, v_collection, v_record_id, v_payload,
        case when jsonb_typeof(v_operation -> 'position') = 'number'
          then (v_operation ->> 'position')::bigint else null end,
        1, v_next_version, v_now, v_now, null
      ) on conflict (user_id, collection, record_id) do nothing;
      get diagnostics v_row_count = row_count;
      if v_row_count <> 1 then
        raise exception 'An Inventory record with this id already exists.' using errcode = '23505';
      end if;
    elsif v_type = 'patch' then
      v_set := coalesce(v_operation -> 'set', '{}'::jsonb);
      if jsonb_typeof(v_set) <> 'object' then
        raise exception 'Inventory patch set must be an object.' using errcode = '22023';
      end if;
      select * into v_record from public.helm_records
      where user_id = p_user_id and collection = v_collection
        and record_id = v_record_id and deleted_at is null for update;
      if not found then raise exception 'Inventory record is missing or deleted.' using errcode = 'P0002'; end if;
      v_payload := v_record.payload || v_set;
      if v_operation ? 'unset' then
        if jsonb_typeof(v_operation -> 'unset') <> 'array' then
          raise exception 'Inventory patch unset must be an array.' using errcode = '22023';
        end if;
        for v_unset_key in select value from jsonb_array_elements_text(v_operation -> 'unset')
        loop v_payload := v_payload - v_unset_key; end loop;
      end if;
      perform helm_private.validate_inventory_payload(v_collection, v_record_id, v_payload);
      update public.helm_records set payload = v_payload, revision = revision + 1,
        account_version = v_next_version, updated_at = v_now
      where user_id = p_user_id and collection = v_collection and record_id = v_record_id;
    elsif v_type = 'increment' then
      v_field := v_operation ->> 'field';
      v_amount := (v_operation ->> 'amount')::numeric;
      if v_collection <> 'inventoryItems' or v_field <> 'quantity' or v_amount is null then
        raise exception 'Only owned Inventory quantity can be incremented.' using errcode = '22023';
      end if;
      select * into v_record from public.helm_records
      where user_id = p_user_id and collection = v_collection
        and record_id = v_record_id and deleted_at is null for update;
      if not found then raise exception 'Inventory item is missing or deleted.' using errcode = 'P0002'; end if;
      v_payload := jsonb_set(v_record.payload, '{quantity}',
        to_jsonb((v_record.payload ->> 'quantity')::numeric + v_amount), false)
        || jsonb_build_object('lastVerifiedAt', v_now, 'updatedAt', v_now);
      perform helm_private.validate_inventory_payload(v_collection, v_record_id, v_payload);
      update public.helm_records set payload = v_payload, revision = revision + 1,
        account_version = v_next_version, updated_at = v_now
      where user_id = p_user_id and collection = v_collection and record_id = v_record_id;
    elsif v_type = 'delete' then
      update public.helm_records set deleted_at = v_now, revision = revision + 1,
        account_version = v_next_version, updated_at = v_now
      where user_id = p_user_id and collection = v_collection
        and record_id = v_record_id and deleted_at is null;
    elsif v_type = 'restore' then
      select * into v_record from public.helm_records
      where user_id = p_user_id and collection = v_collection and record_id = v_record_id for update;
      if not found then raise exception 'Inventory tombstone was not found.' using errcode = 'P0002'; end if;
      perform helm_private.validate_inventory_payload(v_collection, v_record_id, v_record.payload);
      update public.helm_records set deleted_at = null, revision = revision + 1,
        account_version = v_next_version, updated_at = v_now
      where user_id = p_user_id and collection = v_collection and record_id = v_record_id;
    else
      raise exception 'Unsupported Inventory mutation operation.' using errcode = '22023';
    end if;
  end loop;

  update public.helm_account_state set account_version = v_next_version,
    minimum_client_version = '0.2.86', updated_at = v_now
  where user_id = p_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', user_id, 'collection', collection, 'recordId', record_id,
    'payload', payload, 'position', position, 'revision', revision,
    'accountVersion', account_version, 'createdAt', created_at,
    'updatedAt', updated_at, 'deletedAt', deleted_at
  ) order by collection, record_id), '[]'::jsonb)
  into v_changes from public.helm_records
  where user_id = p_user_id and account_version = v_next_version;

  select coalesce(jsonb_agg(jsonb_build_object(
    'collection', collection, 'recordId', record_id,
    'revision', revision, 'deletedAt', deleted_at
  ) order by collection, record_id), '[]'::jsonb)
  into v_event_changes from public.helm_records
  where user_id = p_user_id and account_version = v_next_version;

  v_result := jsonb_build_object(
    'requestId', p_request_id,
    'accountVersion', v_next_version,
    'changes', v_changes
  );
  update public.helm_inventory_mutation_receipts
  set result = v_result, applied_at = v_now
  where user_id = p_user_id and request_id = p_request_id;

  if jsonb_array_length(v_event_changes) > 0 then
    perform realtime.send(
      jsonb_build_object('requestId', p_request_id, 'accountVersion', v_next_version, 'changes', v_event_changes),
      'helm_records_changed',
      'helm:account:' || p_user_id::text,
      true
    );
  end if;
  return v_result;
end;
$$;

revoke execute on function helm_private.apply_inventory_mutations(uuid, uuid, text, jsonb) from public, anon, authenticated;

create function public.apply_helm_inventory_mutations(p_request_id uuid, p_operations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  return helm_private.apply_inventory_mutations(v_user_id, p_request_id, 'first_party_apply', p_operations);
end;
$$;
revoke all on function public.apply_helm_inventory_mutations(uuid, jsonb) from public, anon;
grant execute on function public.apply_helm_inventory_mutations(uuid, jsonb) to authenticated;

create function public.inventory_search(
  p_query text default '',
  p_project_catalog_key text default null,
  p_category text default null,
  p_location text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_query text := lower(btrim(coalesce(p_query, '')));
  v_items jsonb;
  v_needs jsonb;
begin
  v_user_id := helm_private.require_inventory_actor();
  if length(v_query) > 160
    or p_limit is null or p_limit not between 1 and 100
    or (p_project_catalog_key is not null and (
      p_project_catalog_key <> btrim(p_project_catalog_key)
      or length(p_project_catalog_key) not between 1 and 160
    ))
    or (p_category is not null and not (p_category = any(array[
      'machine', 'tool', 'electronics', 'component', 'material',
      'consumable', 'fastener', 'safety', 'storage', 'other'
    ])))
    or (p_location is not null and (
      p_location <> btrim(p_location) or length(p_location) not between 1 and 160
    )) then
    raise exception 'Inventory search bounds are invalid.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(payload order by lower(payload ->> 'name')), '[]'::jsonb)
  into v_items from (
    select record.payload
    from public.helm_records as record
    where record.user_id = v_user_id and record.collection = 'inventoryItems'
      and record.deleted_at is null and not (record.payload ? 'archivedAt')
      and (v_query = '' or lower(record.payload::text) like '%' || v_query || '%')
      and (p_project_catalog_key is null or record.payload -> 'projectCatalogKeys' ? p_project_catalog_key)
      and (p_category is null or record.payload ->> 'category' = p_category)
      and (p_location is null or record.payload ->> 'location' = p_location)
    order by lower(record.payload ->> 'name') limit p_limit
  ) as matched;
  select coalesce(jsonb_agg(payload order by lower(payload ->> 'name')), '[]'::jsonb)
  into v_needs from (
    select record.payload
    from public.helm_records as record
    where record.user_id = v_user_id and record.collection = 'inventoryNeeds'
      and record.deleted_at is null
      and record.payload ->> 'status' = any(array['needed', 'ordered'])
      and (v_query = '' or lower(record.payload::text) like '%' || v_query || '%')
      and (p_project_catalog_key is null or record.payload ->> 'projectCatalogKey' = p_project_catalog_key)
    order by lower(record.payload ->> 'name') limit p_limit
  ) as matched;
  return jsonb_build_object('items', v_items, 'needs', v_needs);
end;
$$;

create function public.inventory_check(
  p_name text,
  p_required_quantity numeric default 1,
  p_unit text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_matches jsonb;
  v_sufficient boolean;
begin
  v_user_id := helm_private.require_inventory_actor();
  if p_name is null or p_name <> btrim(p_name) or length(p_name) not between 1 and 160
    or p_required_quantity is null
    or p_required_quantity < 0 or p_required_quantity > 1000000000
    or (p_unit is not null and (
      p_unit <> btrim(p_unit) or length(p_unit) not between 1 and 32
    )) then
    raise exception 'Inventory check input is invalid.' using errcode = '22023';
  end if;
  select
    coalesce(jsonb_agg(record.payload order by (record.payload ->> 'quantity')::numeric desc), '[]'::jsonb),
    coalesce(bool_or(
      (record.payload ->> 'quantity')::numeric >= p_required_quantity
      and (p_unit is null or lower(record.payload ->> 'unit') = lower(p_unit))
    ), false)
  into v_matches, v_sufficient
  from public.helm_records as record
  where record.user_id = v_user_id and record.collection = 'inventoryItems'
    and record.deleted_at is null and not (record.payload ? 'archivedAt')
    and lower(record.payload ->> 'name') like '%' || lower(p_name) || '%';
  return jsonb_build_object(
    'query', p_name,
    'requiredQuantity', p_required_quantity,
    'unit', p_unit,
    'sufficient', v_sufficient,
    'matches', v_matches
  );
end;
$$;

create function public.inventory_resolve_project(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_projects jsonb;
begin
  v_user_id := helm_private.require_inventory_actor();
  if p_query is null or p_query <> btrim(p_query) or length(p_query) not between 1 and 160 then
    raise exception 'Project query is invalid.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', project.record_id,
    'catalogKey', project.payload ->> 'catalogKey',
    'name', project.payload ->> 'name'
  ) order by lower(project.payload ->> 'name')), '[]'::jsonb)
  into v_projects
  from (
    select record.record_id, record.payload
    from public.helm_records as record
    where record.user_id = v_user_id and record.collection = 'projects'
      and record.deleted_at is null
      and (
        lower(record.payload ->> 'name') like '%' || lower(p_query) || '%'
        or lower(record.payload ->> 'catalogKey') = lower(p_query)
      )
    order by lower(record.payload ->> 'name')
    limit 10
  ) as project;
  return v_projects;
end;
$$;

create function public.inventory_save_items(p_request_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_item jsonb; v_operations jsonb := '[]'::jsonb;
begin
  v_user_id := helm_private.require_inventory_actor();
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100
    or octet_length(p_items::text) > 1048576 then
    raise exception 'Inventory item batch is invalid or too large.' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform helm_private.validate_inventory_payload('inventoryItems', v_item ->> 'id', v_item);
    v_operations := v_operations || jsonb_build_array(jsonb_build_object(
      'op', 'create', 'collection', 'inventoryItems',
      'recordId', v_item ->> 'id', 'payload', v_item
    ));
  end loop;
  return helm_private.apply_inventory_mutations(v_user_id, p_request_id, 'save_items', v_operations);
end;
$$;

create function public.inventory_save_need(p_request_id uuid, p_need jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  v_user_id := helm_private.require_inventory_actor();
  perform helm_private.validate_inventory_payload('inventoryNeeds', p_need ->> 'id', p_need);
  return helm_private.apply_inventory_mutations(v_user_id, p_request_id, 'save_need', jsonb_build_array(jsonb_build_object(
    'op', 'create', 'collection', 'inventoryNeeds',
    'recordId', p_need ->> 'id', 'payload', p_need
  )));
end;
$$;

create function public.inventory_complete_need(
  p_request_id uuid,
  p_need_id text,
  p_new_item_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  v_user_id := helm_private.require_inventory_actor();
  if p_need_id is null or p_need_id <> btrim(p_need_id) or length(p_need_id) not between 1 and 256
    or (p_new_item_id is not null and (
      p_new_item_id <> btrim(p_new_item_id) or length(p_new_item_id) not between 1 and 256
    )) then
    raise exception 'Inventory need id is invalid.' using errcode = '22023';
  end if;
  return helm_private.apply_inventory_mutations(v_user_id, p_request_id, 'complete_need', jsonb_build_array(jsonb_build_object(
    'op', 'acquire_need', 'collection', 'inventoryNeeds',
    'recordId', p_need_id, 'newItemId', p_new_item_id
  )));
end;
$$;

create function public.inventory_archive_item(p_request_id uuid, p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid;
begin
  v_user_id := helm_private.require_inventory_actor();
  if p_item_id is null or p_item_id <> btrim(p_item_id) or length(p_item_id) not between 1 and 256 then
    raise exception 'Inventory item id is invalid.' using errcode = '22023';
  end if;
  return helm_private.apply_inventory_mutations(v_user_id, p_request_id, 'archive_item', jsonb_build_array(jsonb_build_object(
    'op', 'patch', 'collection', 'inventoryItems', 'recordId', p_item_id,
    'set', jsonb_build_object('archivedAt', now(), 'updatedAt', now()), 'unset', '[]'::jsonb
  )));
end;
$$;

create function public.list_inventory_oauth_clients()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_clients jsonb;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  select coalesce(jsonb_agg(jsonb_build_object(
    'clientId', client_id, 'clientName', client_name,
    'approvedAt', approved_at, 'revokedAt', revoked_at
  ) order by approved_at desc), '[]'::jsonb)
  into v_clients from public.helm_inventory_oauth_clients where user_id = v_user_id;
  return v_clients;
end;
$$;

create function public.approve_inventory_oauth_client(p_client_id text, p_client_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_client public.helm_inventory_oauth_clients%rowtype;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  if p_client_id is null or p_client_id <> btrim(p_client_id) or length(p_client_id) not between 1 and 512
    or p_client_name is null or p_client_name <> btrim(p_client_name) or length(p_client_name) not between 1 and 160 then
    raise exception 'OAuth client identity is invalid.' using errcode = '22023';
  end if;
  insert into public.helm_inventory_oauth_clients (
    user_id, client_id, client_name, approved_at, revoked_at, updated_at
  ) values (v_user_id, p_client_id, p_client_name, now(), null, now())
  on conflict (user_id, client_id) do update set
    client_name = excluded.client_name, approved_at = now(), revoked_at = null, updated_at = now()
  returning * into v_client;
  return jsonb_build_object(
    'clientId', v_client.client_id, 'clientName', v_client.client_name,
    'approvedAt', v_client.approved_at, 'revokedAt', v_client.revoked_at
  );
end;
$$;

create function public.revoke_inventory_oauth_client(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_client public.helm_inventory_oauth_clients%rowtype;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  if p_client_id is null or p_client_id <> btrim(p_client_id)
    or length(p_client_id) not between 1 and 512 then
    raise exception 'OAuth client identity is invalid.' using errcode = '22023';
  end if;
  update public.helm_inventory_oauth_clients set revoked_at = now(), updated_at = now()
  where user_id = v_user_id and client_id = p_client_id
  returning * into v_client;
  if not found then raise exception 'Approved OAuth client was not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'clientId', v_client.client_id, 'clientName', v_client.client_name,
    'approvedAt', v_client.approved_at, 'revokedAt', v_client.revoked_at
  );
end;
$$;

-- Every public Inventory RPC is field-allowlisted; raw broad account RPCs and
-- secret functions are first-party only.
revoke all on function public.inventory_search(text, text, text, text, integer) from public, anon;
revoke all on function public.inventory_check(text, numeric, text) from public, anon;
revoke all on function public.inventory_resolve_project(text) from public, anon;
revoke all on function public.inventory_save_items(uuid, jsonb) from public, anon;
revoke all on function public.inventory_save_need(uuid, jsonb) from public, anon;
revoke all on function public.inventory_complete_need(uuid, text, text) from public, anon;
revoke all on function public.inventory_archive_item(uuid, text) from public, anon;
revoke all on function public.list_inventory_oauth_clients() from public, anon;
revoke all on function public.approve_inventory_oauth_client(text, text) from public, anon;
revoke all on function public.revoke_inventory_oauth_client(text) from public, anon;

grant execute on function public.inventory_search(text, text, text, text, integer) to authenticated;
grant execute on function public.inventory_check(text, numeric, text) to authenticated;
grant execute on function public.inventory_resolve_project(text) to authenticated;
grant execute on function public.inventory_save_items(uuid, jsonb) to authenticated;
grant execute on function public.inventory_save_need(uuid, jsonb) to authenticated;
grant execute on function public.inventory_complete_need(uuid, text, text) to authenticated;
grant execute on function public.inventory_archive_item(uuid, text) to authenticated;
grant execute on function public.list_inventory_oauth_clients() to authenticated;
grant execute on function public.approve_inventory_oauth_client(text, text) to authenticated;
grant execute on function public.revoke_inventory_oauth_client(text) to authenticated;

-- Wrap every pre-existing non-Inventory account RPC so an OAuth client cannot
-- escape into snapshots, secrets, or generic state.
alter function public.get_helm_account_snapshot() set schema helm_private;
alter function helm_private.get_helm_account_snapshot() rename to get_helm_account_snapshot_direct;
revoke execute on function helm_private.get_helm_account_snapshot_direct() from public, anon, authenticated;
create function public.get_helm_account_snapshot()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_user_id uuid := (select auth.uid()); v_result jsonb;
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false)
    or nullif((select auth.jwt() ->> 'client_id'), '') is not null then
    raise exception 'This session cannot read a Sabah One account snapshot.' using errcode = '42501';
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
    from public.helm_records as record where record.user_id = v_user_id), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

alter function public.list_helm_secrets() set schema helm_private;
alter function helm_private.list_helm_secrets() rename to list_helm_secrets_direct;
revoke execute on function helm_private.list_helm_secrets_direct() from public, anon, authenticated;
create function public.list_helm_secrets()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform helm_private.assert_direct_sabah_one_session();
  return helm_private.list_helm_secrets_direct();
end;
$$;

alter function public.reveal_helm_secret(uuid) set schema helm_private;
alter function helm_private.reveal_helm_secret(uuid) rename to reveal_helm_secret_direct;
revoke execute on function helm_private.reveal_helm_secret_direct(uuid) from public, anon, authenticated;
create function public.reveal_helm_secret(p_secret_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform helm_private.assert_direct_sabah_one_session();
  return helm_private.reveal_helm_secret_direct(p_secret_id);
end;
$$;

alter function public.save_helm_secret(uuid, uuid, text, text, text, text[], text, text, text, text, text) set schema helm_private;
alter function helm_private.save_helm_secret(uuid, uuid, text, text, text, text[], text, text, text, text, text) rename to save_helm_secret_direct;
revoke execute on function helm_private.save_helm_secret_direct(uuid, uuid, text, text, text, text[], text, text, text, text, text) from public, anon, authenticated;
create function public.save_helm_secret(
  p_request_id uuid, p_secret_id uuid, p_label text, p_kind text,
  p_environment text, p_project_catalog_keys text[], p_value text,
  p_username text, p_url text, p_notes text, p_source_ref text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform helm_private.assert_direct_sabah_one_session();
  return helm_private.save_helm_secret_direct(
    p_request_id, p_secret_id, p_label, p_kind, p_environment,
    p_project_catalog_keys, p_value, p_username, p_url, p_notes, p_source_ref
  );
end;
$$;

alter function public.set_helm_secret_archived(uuid, uuid, boolean) set schema helm_private;
alter function helm_private.set_helm_secret_archived(uuid, uuid, boolean) rename to set_helm_secret_archived_direct;
revoke execute on function helm_private.set_helm_secret_archived_direct(uuid, uuid, boolean) from public, anon, authenticated;
create function public.set_helm_secret_archived(p_request_id uuid, p_secret_id uuid, p_archived boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform helm_private.assert_direct_sabah_one_session();
  return helm_private.set_helm_secret_archived_direct(p_request_id, p_secret_id, p_archived);
end;
$$;

revoke execute on function public.set_google_calendar_credentials_updated_at() from public, anon, authenticated;
revoke all on function public.get_helm_account_snapshot() from public, anon;
revoke all on function public.list_helm_secrets() from public, anon;
revoke all on function public.reveal_helm_secret(uuid) from public, anon;
revoke all on function public.save_helm_secret(uuid, uuid, text, text, text, text[], text, text, text, text, text) from public, anon;
revoke all on function public.set_helm_secret_archived(uuid, uuid, boolean) from public, anon;
grant execute on function public.get_helm_account_snapshot() to authenticated;
grant execute on function public.list_helm_secrets() to authenticated;
grant execute on function public.reveal_helm_secret(uuid) to authenticated;
grant execute on function public.save_helm_secret(uuid, uuid, text, text, text, text[], text, text, text, text, text) to authenticated;
grant execute on function public.set_helm_secret_archived(uuid, uuid, boolean) to authenticated;

commit;
