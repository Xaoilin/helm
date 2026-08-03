-- Add bounded visual classification metadata without changing Inventory ownership or OAuth scope.
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
    'specifications', 'condition', 'location', 'tags', 'notes',
    'projectCatalogKeys', 'lastVerifiedAt', 'archivedAt', 'createdAt', 'updatedAt'
  ];
  v_allowed_need_keys constant text[] := array[
    'id', 'name', 'category', 'subcategory', 'imageUrl', 'linkedItemId',
    'projectCatalogKey', 'requiredQuantity', 'unit', 'specifications',
    'priority', 'status', 'notes', 'orderedAt', 'acquiredAt', 'dismissedAt',
    'createdAt', 'updatedAt'
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

revoke execute on function helm_private.validate_inventory_payload(text, text, jsonb)
  from public, anon, authenticated;

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
      );
  end if;
  return new;
end;
$$;

revoke execute on function helm_private.copy_inventory_need_visuals_to_acquired_item()
  from public, anon, authenticated;

drop trigger if exists helm_inventory_need_visuals_after_update on public.helm_records;
create trigger helm_inventory_need_visuals_after_update
after update of payload on public.helm_records
for each row execute function helm_private.copy_inventory_need_visuals_to_acquired_item();
