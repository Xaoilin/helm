-- Optional physical dimensions for Sabah One Inventory. This migration keeps
-- the schema version and client floor unchanged because older clients can
-- safely ignore the new field.

create or replace function helm_private.validate_inventory_dimensions(p_value jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_axis numeric;
  v_has_axis boolean := false;
  v_unit text;
begin
  if jsonb_typeof(p_value) <> 'object' then
    raise exception 'Inventory dimensions must be an object.' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_value)
  loop
    if not (v_key = any(array['length', 'width', 'height', 'unit'])) then
      raise exception 'Unsupported Inventory dimension field: %.', v_key using errcode = '22023';
    end if;
  end loop;

  v_unit := p_value ->> 'unit';
  if jsonb_typeof(p_value -> 'unit') <> 'string'
    or v_unit <> btrim(v_unit)
    or not (v_unit = any(array['mm', 'cm', 'm', 'in'])) then
    raise exception 'Inventory dimension unit must be mm, cm, m, or in.' using errcode = '22023';
  end if;

  for v_key in select unnest(array['length', 'width', 'height'])
  loop
    if p_value ? v_key then
      if jsonb_typeof(p_value -> v_key) <> 'number' then
        raise exception 'Inventory dimension % must be numeric.', v_key using errcode = '22023';
      end if;
      v_axis := (p_value ->> v_key)::numeric;
      if v_axis <= 0 then
        raise exception 'Inventory dimension % must be positive.', v_key using errcode = '22023';
      end if;
      v_has_axis := true;
    end if;
  end loop;

  if not v_has_axis then
    raise exception 'Inventory dimensions require at least one positive axis.' using errcode = '22023';
  end if;
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
  v_category text;
  v_subcategory text;
  v_expected_category text;
  v_image_url text;
  v_allowed_item_keys constant text[] := array[
    'id', 'name', 'category', 'subcategory', 'imageUrl', 'trackingMode',
    'quantity', 'unit', 'lowStockThreshold', 'brand', 'model',
    'dimensions', 'specifications', 'condition', 'location', 'tags', 'notes',
    'projectCatalogKeys', 'lastVerifiedAt', 'archivedAt', 'createdAt', 'updatedAt'
  ];
  v_allowed_need_keys constant text[] := array[
    'id', 'name', 'category', 'subcategory', 'imageUrl', 'linkedItemId',
    'projectCatalogKey', 'requiredQuantity', 'unit', 'dimensions',
    'specifications', 'priority', 'status', 'notes', 'orderedAt', 'acquiredAt',
    'dismissedAt', 'createdAt', 'updatedAt'
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
    if p_payload ? 'category' and not ((p_payload ->> 'category') = any(array[
      'machine', 'tool', 'electronics', 'component', 'material',
      'consumable', 'fastener', 'safety', 'storage', 'other'
    ])) then
      raise exception 'Inventory need category is invalid.' using errcode = '22023';
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

  if p_payload ? 'subcategory' then
    if jsonb_typeof(p_payload -> 'subcategory') <> 'string' then
      raise exception 'Inventory subcategory is invalid.' using errcode = '22023';
    end if;
    v_subcategory := p_payload ->> 'subcategory';
    v_category := p_payload ->> 'category';
    v_expected_category := case v_subcategory
      when '3d_printers' then 'machine'
      when 'other_machines' then 'machine'
      when 'workshop_equipment' then 'tool'
      when 'general_tools' then 'tool'
      when 'hand_tools' then 'tool'
      when 'power_tools' then 'tool'
      when 'measuring_tools' then 'tool'
      when 'screws_fasteners' then 'fastener'
      when 'filament' then 'material'
      when 'resin' then 'material'
      when 'wire_cable' then 'material'
      when 'connectors_terminals' then 'component'
      when 'power_supplies' then 'electronics'
      when 'power_modules' then 'component'
      when 'switches_relays' then 'component'
      when 'microcontrollers' then 'electronics'
      when 'prototyping_boards' then 'component'
      when 'fuses_protection' then 'component'
      when 'lights_alarms' then 'component'
      when 'heat_shrink_sleeving' then 'consumable'
      when 'cable_management' then 'consumable'
      when 'magnets' then 'component'
      when 'adhesives_tapes' then 'material'
      when 'mechanical_hardware' then 'component'
      when 'general_components' then 'component'
      when 'general_electronics' then 'electronics'
      when 'general_materials' then 'material'
      when 'general_consumables' then 'consumable'
      when 'storage_organisation' then 'storage'
      when 'safety_equipment' then 'safety'
      when 'other' then 'other'
      else null
    end;
    if v_expected_category is null or v_category is distinct from v_expected_category then
      raise exception 'Inventory subcategory does not match its category.' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'imageUrl' then
    if jsonb_typeof(p_payload -> 'imageUrl') <> 'string' then
      raise exception 'Inventory image URL must be a valid HTTPS address.' using errcode = '22023';
    end if;
    v_image_url := p_payload ->> 'imageUrl';
    if v_image_url <> btrim(v_image_url)
      or length(v_image_url) not between 1 and 2048
      or v_image_url !~ '^https://[^/@:[:space:]]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
      raise exception 'Inventory image URL must be a valid HTTPS address.' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'dimensions' then
    perform helm_private.validate_inventory_dimensions(p_payload -> 'dimensions');
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
    -- A legacy or partial client may omit this newly introduced field. Keep
    -- the existing server value unless a complete dimensions value is set.
    if tg_op = 'UPDATE'
      and old.payload ? 'dimensions'
      and not (new.payload ? 'dimensions') then
      new.payload := new.payload || jsonb_build_object('dimensions', old.payload -> 'dimensions');
    end if;
    perform helm_private.validate_inventory_payload(new.collection, new.record_id, new.payload);
  end if;
  return new;
end;
$$;

create or replace function helm_private.copy_inventory_need_visuals_to_acquired_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.collection = 'inventoryNeeds'
    and old.payload ->> 'status' = any(array['needed', 'ordered'])
    and new.payload ->> 'status' = 'acquired'
    and nullif(new.payload ->> 'linkedItemId', '') is not null then
    update public.helm_records as item
    set payload = item.payload
      || case
        when new.payload ? 'subcategory' and not (item.payload ? 'subcategory')
        then jsonb_build_object(
          'category', new.payload ->> 'category',
          'subcategory', new.payload ->> 'subcategory'
        )
        else '{}'::jsonb
      end
      || case
        when new.payload ? 'imageUrl' and not (item.payload ? 'imageUrl')
        then jsonb_build_object('imageUrl', new.payload ->> 'imageUrl')
        else '{}'::jsonb
      end
      || case
        when new.payload ? 'dimensions' and not (item.payload ? 'dimensions')
        then jsonb_build_object('dimensions', new.payload -> 'dimensions')
        else '{}'::jsonb
      end,
      revision = item.revision + 1,
      updated_at = new.updated_at
    where item.user_id = new.user_id
      and item.collection = 'inventoryItems'
      and item.record_id = new.payload ->> 'linkedItemId'
      and item.deleted_at is null
      and (
        (new.payload ? 'subcategory' and not (item.payload ? 'subcategory'))
        or (new.payload ? 'imageUrl' and not (item.payload ? 'imageUrl'))
        or (new.payload ? 'dimensions' and not (item.payload ? 'dimensions'))
      );
  end if;
  return new;
end;
$$;

create or replace function public.inventory_save_items(p_request_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_item jsonb;
  v_existing public.helm_records%rowtype;
  v_payload jsonb;
  v_set jsonb;
  v_operations jsonb := '[]'::jsonb;
  v_now timestamptz := now();
begin
  v_user_id := helm_private.require_inventory_actor();
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100
    or octet_length(p_items::text) > 1048576 then
    raise exception 'Inventory item batch is invalid or too large.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or v_item ->> 'id' is null
      or btrim(v_item ->> 'id') = ''
      or length(v_item ->> 'id') > 256 then
      raise exception 'Inventory item id is required and bounded.' using errcode = '22023';
    end if;

    select * into v_existing
    from public.helm_records
    where user_id = v_user_id
      and collection = 'inventoryItems'
      and record_id = v_item ->> 'id'
      and deleted_at is null
    for update;

    if found then
      -- Ownership is derived from auth.uid() and createdAt is immutable.
      -- Only fields supplied by the caller are patched; all other data stays.
      v_payload := v_existing.payload || v_item;
      v_payload := v_payload || jsonb_build_object(
        'id', v_existing.record_id,
        'createdAt', v_existing.payload -> 'createdAt',
        'updatedAt', to_jsonb(v_now)
      );
      perform helm_private.validate_inventory_payload('inventoryItems', v_existing.record_id, v_payload);
      v_set := (v_item - 'id' - 'createdAt') || jsonb_build_object('updatedAt', to_jsonb(v_now));
      v_operations := v_operations || jsonb_build_array(jsonb_build_object(
        'op', 'patch', 'collection', 'inventoryItems',
        'recordId', v_existing.record_id, 'set', v_set, 'unset', '[]'::jsonb
      ));
    else
      v_payload := v_item;
      perform helm_private.validate_inventory_payload('inventoryItems', v_item ->> 'id', v_payload);
      v_operations := v_operations || jsonb_build_array(jsonb_build_object(
        'op', 'create', 'collection', 'inventoryItems',
        'recordId', v_item ->> 'id', 'payload', v_payload
      ));
    end if;
  end loop;

  return helm_private.apply_inventory_mutations(v_user_id, p_request_id, 'save_items', v_operations);
end;
$$;

revoke execute on function helm_private.validate_inventory_dimensions(jsonb) from public, anon, authenticated;
revoke execute on function helm_private.validate_inventory_payload(text, text, jsonb) from public, anon, authenticated;
revoke execute on function helm_private.validate_sabah_one_record() from public, anon, authenticated;
revoke all on function public.inventory_save_items(uuid, jsonb) from public, anon;
grant execute on function public.inventory_save_items(uuid, jsonb) to authenticated;
