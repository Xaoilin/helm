-- Phase 5 of the Spring migration: retire the generic record store.
--
-- Every domain now loads and saves through its Spring service (profile, prayer, calendar, life,
-- knowledge, planner, finance), and open tabs learn of changes from the services' live-update stream.
-- Nothing reads or writes account data through the generic record RPCs, the per-domain RPCs that the
-- first Inventory, Employment, Equity and Finance agent tools used, or Realtime Broadcast any more:
-- the Inventory and Employment MCP functions now check an agent's approval with the life service.
--
-- Kept: Supabase Auth; the Vault secrets (their RPCs, now without a Broadcast) and the account state
-- row they number their changes with; the agent OAuth approval tables with their approve, list and
-- revoke RPCs; and public.helm_records itself, whose rows the services imported once (they are
-- deleted separately).
begin;

-- 1. The generic record store: account snapshots, change metadata and mutations.
drop function if exists public.get_helm_account_snapshot();
drop function if exists public.get_helm_account_snapshot_for_collections(text[]);
drop function if exists public.get_helm_changed_collections(bigint);
drop function if exists public.apply_helm_mutations(uuid, jsonb);
drop function if exists helm_private.apply_helm_mutations_direct(uuid, jsonb);
drop function if exists helm_private.get_helm_account_snapshot_direct();
drop table if exists public.helm_mutation_receipts;
drop table if exists public.helm_legacy_quarantine;

-- 2. The legacy Inventory RPCs (the life service owns Inventory) and the record triggers they needed.
drop function if exists public.apply_helm_inventory_mutations(uuid, jsonb);
drop function if exists public.inventory_search(text, text, text, text, integer);
drop function if exists public.inventory_check(text, numeric, text);
drop function if exists public.inventory_save_items(uuid, jsonb);
drop function if exists public.inventory_save_need(uuid, jsonb);
drop function if exists public.inventory_complete_need(uuid, text, text);
drop function if exists public.inventory_archive_item(uuid, text);
drop function if exists helm_private.apply_inventory_mutations(uuid, uuid, text, jsonb);
drop function if exists helm_private.require_inventory_actor();
drop trigger if exists helm_inventory_need_visuals_after_update on public.helm_records;
drop function if exists helm_private.copy_inventory_need_visuals_to_acquired_item();
drop trigger if exists helm_validate_sabah_one_record on public.helm_records;
drop function if exists helm_private.validate_sabah_one_record();
drop function if exists helm_private.validate_inventory_payload(text, text, jsonb);
drop function if exists helm_private.validate_inventory_text_array(jsonb, text, integer, integer);
drop function if exists helm_private.validate_inventory_specifications(jsonb);
drop function if exists helm_private.validate_inventory_dimensions(jsonb);
drop table if exists public.helm_inventory_mutation_receipts;

-- The record read policy let an approved Inventory agent read Inventory records. Agents now read
-- Inventory from the life service, so the remaining (import-only) records are first-party only.
drop policy if exists "Sabah One records respect OAuth inventory boundary" on public.helm_records;
create policy "Sabah One records are first party"
on public.helm_records
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and nullif((select auth.jwt() ->> 'client_id'), '') is null
);
drop function if exists helm_private.inventory_client_is_approved(uuid, text);

-- 3. The legacy Employment RPCs (the life service owns the job tracker).
drop function if exists public.employment_list_applications(text, text, integer, integer, text, text);
drop function if exists public.employment_get_application(text);
drop function if exists public.employment_add_application(uuid, jsonb);
drop function if exists public.employment_update_application(uuid, text, jsonb, text);
drop function if exists public.employment_add_history(uuid, text, jsonb);
drop function if exists public.employment_remove_application(uuid, text, boolean, text);
drop function if exists helm_private.mutate_employment(uuid, text, text, jsonb, text);
drop function if exists helm_private.validate_employment_payload(jsonb, boolean);
drop function if exists helm_private.require_employment_actor();
drop table if exists public.helm_employment_mutation_receipts;

-- 4. The Finance review and Equity RPCs (the finance service owns them).
drop function if exists public.finance_get_review();
drop function if exists public.finance_save_review(uuid, jsonb, text);
drop function if exists helm_private.validate_finance_payload(jsonb, text);
drop function if exists helm_private.require_finance_actor();
drop table if exists public.helm_finance_mutation_receipts;
drop function if exists public.equity_list_positions(text, integer, integer);
drop function if exists public.equity_get_position(text);
drop function if exists public.equity_add_position(uuid, jsonb);
drop function if exists public.equity_update_position(uuid, text, jsonb, text);
drop function if exists public.equity_remove_position(uuid, text, boolean, text);
drop function if exists helm_private.mutate_equity(uuid, text, text, jsonb, text);
drop function if exists helm_private.validate_equity_payload(jsonb, text);
drop function if exists helm_private.require_equity_actor();
drop table if exists public.helm_equity_mutation_receipts;

-- 5. Realtime Broadcast. The Secrets page reloads its summaries after its own writes and whenever it
--    is shown again, so the two secret writes stop broadcasting; they are otherwise unchanged.
create or replace function helm_private.save_helm_secret_direct(
  p_request_id uuid,
  p_secret_id uuid,
  p_label text,
  p_kind text,
  p_environment text,
  p_project_catalog_keys text[],
  p_value text,
  p_username text,
  p_url text,
  p_notes text,
  p_source_ref text
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
  v_entry public.helm_secret_entries%rowtype;
  v_existing_payload jsonb;
  v_payload jsonb;
  v_secret_id uuid := coalesce(p_secret_id, gen_random_uuid());
  v_vault_secret_id uuid;
  v_next_version bigint;
  v_result jsonb;
  v_claimed boolean;
  v_project_key text;
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in HELM account is required.' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'A mutation request id is required.' using errcode = '22023';
  end if;
  if p_label is null or p_label <> btrim(p_label) or length(p_label) not between 1 and 120 then
    raise exception 'Secret labels must contain between 1 and 120 characters.' using errcode = '22023';
  end if;
  if p_kind is null or not (p_kind = any(array[
    'password', 'api_key', 'access_token', 'database', 'private_key', 'webhook', 'other'
  ])) then
    raise exception 'Unsupported HELM secret kind.' using errcode = '22023';
  end if;
  if p_environment is not null
    and (p_environment <> btrim(p_environment) or length(p_environment) not between 1 and 80) then
    raise exception 'Secret environments must remain under 80 characters.' using errcode = '22023';
  end if;
  if p_source_ref is not null
    and (p_source_ref <> btrim(p_source_ref) or length(p_source_ref) not between 1 and 256) then
    raise exception 'Secret source references must remain under 256 characters.' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_project_catalog_keys, '{}'::text[])) > 25
    or array_position(coalesce(p_project_catalog_keys, '{}'::text[]), null) is not null then
    raise exception 'A secret may reference at most 25 projects.' using errcode = '22023';
  end if;
  foreach v_project_key in array coalesce(p_project_catalog_keys, '{}'::text[])
  loop
    if v_project_key <> btrim(v_project_key)
      or length(v_project_key) not between 1 and 160 then
      raise exception 'Secret project keys must remain under 160 characters.' using errcode = '22023';
    end if;
  end loop;
  if p_value is not null and (octet_length(p_value) = 0 or octet_length(p_value) > 65536) then
    raise exception 'Secret values must contain between 1 byte and 64 KiB.' using errcode = '22023';
  end if;
  if p_username is not null and octet_length(p_username) > 512 then
    raise exception 'Secret usernames must remain under 512 bytes.' using errcode = '22023';
  end if;
  if p_url is not null and octet_length(p_url) > 2048 then
    raise exception 'Secret URLs must remain under 2 KiB.' using errcode = '22023';
  end if;
  if p_notes is not null and octet_length(p_notes) > 8192 then
    raise exception 'Secret notes must remain under 8 KiB.' using errcode = '22023';
  end if;

  insert into public.helm_secret_mutation_receipts (user_id, request_id, result)
  values (v_user_id, p_request_id, null)
  on conflict (user_id, request_id) do nothing
  returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    select result into v_result
    from public.helm_secret_mutation_receipts
    where user_id = v_user_id and request_id = p_request_id;
    if v_result is null then
      raise exception 'The matching HELM secret mutation is still being committed.' using errcode = '40001';
    end if;
    return v_result;
  end if;

  insert into public.helm_account_state (
    user_id, schema_version, account_version, minimum_client_version, updated_at
  ) values (v_user_id, 1, 0, '0.2.82', now())
  on conflict (user_id) do nothing;

  select account_version + 1 into v_next_version
  from public.helm_account_state
  where user_id = v_user_id
  for update;

  if p_secret_id is null then
    if p_value is null then
      raise exception 'A value is required when creating a HELM secret.' using errcode = '22023';
    end if;
    v_payload := jsonb_build_object(
      'value', p_value,
      'username', p_username,
      'url', p_url,
      'notes', p_notes
    );
    select vault.create_secret(
      v_payload::text,
      'helm-secret:' || v_secret_id::text,
      ''
    ) into v_vault_secret_id;

    insert into public.helm_secret_entries (
      user_id, secret_id, label, kind, environment, project_catalog_keys,
      vault_secret_id, source_ref, revision, account_version,
      created_at, updated_at, archived_at
    ) values (
      v_user_id, v_secret_id, p_label, p_kind, nullif(p_environment, ''),
      coalesce(p_project_catalog_keys, '{}'::text[]), v_vault_secret_id,
      nullif(p_source_ref, ''), 1, v_next_version, now(), now(), null
    ) returning * into v_entry;
  else
    select * into v_entry
    from public.helm_secret_entries
    where user_id = v_user_id and secret_id = p_secret_id
    for update;
    if not found then
      raise exception 'The HELM secret does not exist.' using errcode = 'P0002';
    end if;

    select decrypted_secret::jsonb into v_existing_payload
    from vault.decrypted_secrets
    where id = v_entry.vault_secret_id;
    if not found or jsonb_typeof(v_existing_payload) <> 'object' then
      raise exception 'The encrypted HELM secret is unavailable.' using errcode = 'P0002';
    end if;

    v_payload := jsonb_build_object(
      'value', coalesce(p_value, v_existing_payload ->> 'value'),
      'username', p_username,
      'url', p_url,
      'notes', p_notes
    );
    perform vault.update_secret(v_entry.vault_secret_id, v_payload::text, null, null, null);

    update public.helm_secret_entries
    set
      label = p_label,
      kind = p_kind,
      environment = nullif(p_environment, ''),
      project_catalog_keys = coalesce(p_project_catalog_keys, '{}'::text[]),
      source_ref = nullif(p_source_ref, ''),
      revision = revision + 1,
      account_version = v_next_version,
      updated_at = now()
    where user_id = v_user_id and secret_id = p_secret_id
    returning * into v_entry;
  end if;

  update public.helm_account_state
  set account_version = v_next_version, updated_at = now()
  where user_id = v_user_id;

  v_result := jsonb_build_object(
    'secretId', v_entry.secret_id,
    'label', v_entry.label,
    'kind', v_entry.kind,
    'environment', v_entry.environment,
    'projectCatalogKeys', v_entry.project_catalog_keys,
    'sourceRef', v_entry.source_ref,
    'revision', v_entry.revision,
    'accountVersion', v_entry.account_version,
    'createdAt', v_entry.created_at,
    'updatedAt', v_entry.updated_at,
    'archivedAt', v_entry.archived_at
  );

  update public.helm_secret_mutation_receipts
  set result = v_result, applied_at = now()
  where user_id = v_user_id and request_id = p_request_id;

  return v_result;
end;
$$;

create or replace function helm_private.set_helm_secret_archived_direct(
  p_request_id uuid,
  p_secret_id uuid,
  p_archived boolean
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
  v_entry public.helm_secret_entries%rowtype;
  v_next_version bigint;
  v_result jsonb;
  v_claimed boolean;
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in HELM account is required.' using errcode = '42501';
  end if;
  if p_request_id is null or p_secret_id is null or p_archived is null then
    raise exception 'A request id, secret id, and archive state are required.' using errcode = '22023';
  end if;

  insert into public.helm_secret_mutation_receipts (user_id, request_id, result)
  values (v_user_id, p_request_id, null)
  on conflict (user_id, request_id) do nothing
  returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    select result into v_result
    from public.helm_secret_mutation_receipts
    where user_id = v_user_id and request_id = p_request_id;
    if v_result is null then
      raise exception 'The matching HELM secret mutation is still being committed.' using errcode = '40001';
    end if;
    return v_result;
  end if;

  select account_version + 1 into v_next_version
  from public.helm_account_state
  where user_id = v_user_id
  for update;
  if not found then
    raise exception 'HELM account state is unavailable.' using errcode = 'P0002';
  end if;

  update public.helm_secret_entries
  set
    archived_at = case when p_archived then now() else null end,
    revision = revision + 1,
    account_version = v_next_version,
    updated_at = now()
  where user_id = v_user_id
    and secret_id = p_secret_id
  returning * into v_entry;
  if not found then
    raise exception 'The HELM secret does not exist.' using errcode = 'P0002';
  end if;

  update public.helm_account_state
  set account_version = v_next_version, updated_at = now()
  where user_id = v_user_id;

  v_result := jsonb_build_object(
    'secretId', v_entry.secret_id,
    'label', v_entry.label,
    'kind', v_entry.kind,
    'environment', v_entry.environment,
    'projectCatalogKeys', v_entry.project_catalog_keys,
    'sourceRef', v_entry.source_ref,
    'revision', v_entry.revision,
    'accountVersion', v_entry.account_version,
    'createdAt', v_entry.created_at,
    'updatedAt', v_entry.updated_at,
    'archivedAt', v_entry.archived_at
  );

  update public.helm_secret_mutation_receipts
  set result = v_result, applied_at = now()
  where user_id = v_user_id and request_id = p_request_id;

  return v_result;
end;
$$;

revoke execute on function helm_private.save_helm_secret_direct(
  uuid, uuid, text, text, text, text[], text, text, text, text, text
) from public, anon, authenticated;
revoke execute on function helm_private.set_helm_secret_archived_direct(uuid, uuid, boolean)
  from public, anon, authenticated;

drop policy if exists "HELM account broadcasts are private" on realtime.messages;

commit;
