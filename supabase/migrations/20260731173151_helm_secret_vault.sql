begin;

create extension if not exists supabase_vault with schema vault;

create table public.helm_secret_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_id uuid not null default gen_random_uuid(),
  label text not null check (label = btrim(label) and length(label) between 1 and 120),
  kind text not null check (kind = any(array[
    'password', 'api_key', 'access_token', 'database', 'private_key', 'webhook', 'other'
  ])),
  environment text check (environment is null or (environment = btrim(environment) and length(environment) between 1 and 80)),
  project_catalog_keys text[] not null default '{}'::text[],
  vault_secret_id uuid not null unique,
  source_ref text check (source_ref is null or (source_ref = btrim(source_ref) and length(source_ref) between 1 and 256)),
  revision bigint not null default 1 check (revision > 0),
  account_version bigint not null check (account_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint helm_secret_entries_pkey primary key (user_id, secret_id),
  constraint helm_secret_entries_source_ref_unique unique (user_id, source_ref),
  constraint helm_secret_entries_project_keys_bounded check (
    cardinality(project_catalog_keys) <= 25
    and array_position(project_catalog_keys, null) is null
  )
);

create table public.helm_secret_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  result jsonb,
  applied_at timestamptz not null default now(),
  constraint helm_secret_mutation_receipts_pkey primary key (user_id, request_id)
);

create index helm_secret_entries_active_label_idx
  on public.helm_secret_entries (user_id, lower(label), secret_id)
  where archived_at is null;

alter table public.helm_secret_entries enable row level security;
alter table public.helm_secret_mutation_receipts enable row level security;

revoke all on public.helm_secret_entries from public, anon, authenticated;
revoke all on public.helm_secret_mutation_receipts from public, anon, authenticated;

-- The legacy snapshot remains readable to its owning signed-in account, but
-- the auth lookup is evaluated once and the policy exposes no write path.
drop policy if exists "User isolation" on public.kv_store;
create policy "User isolation"
on public.kv_store
for select
to authenticated
using ((select auth.uid())::text = user_id);

-- This historical trigger function predates the database-authoritative
-- cutover. Pin its lookup path before privileged account RPCs are introduced.
alter function public.set_google_calendar_credentials_updated_at()
set search_path = '';

create or replace function helm_private.delete_secret_vault_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$$;

revoke execute on function helm_private.delete_secret_vault_value() from public, anon, authenticated;

create trigger helm_delete_secret_vault_value
before delete on public.helm_secret_entries
for each row execute function helm_private.delete_secret_vault_value();

create or replace function public.list_helm_secrets()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_account_version bigint;
  v_secrets jsonb;
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in HELM account is required.' using errcode = '42501';
  end if;

  select account_version
  into v_account_version
  from public.helm_account_state
  where user_id = v_user_id;

  if not found then
    raise exception 'HELM account state is unavailable.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'secretId', entry.secret_id,
    'label', entry.label,
    'kind', entry.kind,
    'environment', entry.environment,
    'projectCatalogKeys', entry.project_catalog_keys,
    'sourceRef', entry.source_ref,
    'revision', entry.revision,
    'accountVersion', entry.account_version,
    'createdAt', entry.created_at,
    'updatedAt', entry.updated_at,
    'archivedAt', entry.archived_at
  ) order by (entry.archived_at is not null), lower(entry.label), entry.secret_id), '[]'::jsonb)
  into v_secrets
  from public.helm_secret_entries as entry
  where entry.user_id = v_user_id;

  return jsonb_build_object(
    'accountVersion', v_account_version,
    'secrets', v_secrets
  );
end;
$$;

create or replace function public.reveal_helm_secret(p_secret_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_payload jsonb;
begin
  if v_user_id is null
    or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in HELM account is required.' using errcode = '42501';
  end if;
  if p_secret_id is null then
    raise exception 'A secret id is required.' using errcode = '22023';
  end if;

  select decrypted.decrypted_secret::jsonb
  into v_payload
  from public.helm_secret_entries as entry
  join vault.decrypted_secrets as decrypted on decrypted.id = entry.vault_secret_id
  where entry.user_id = v_user_id
    and entry.secret_id = p_secret_id
    and entry.archived_at is null;

  if not found or jsonb_typeof(v_payload) <> 'object' then
    raise exception 'The HELM secret is unavailable.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'secretId', p_secret_id,
    'value', coalesce(v_payload ->> 'value', ''),
    'username', v_payload ->> 'username',
    'url', v_payload ->> 'url',
    'notes', v_payload ->> 'notes'
  );
end;
$$;

create or replace function public.save_helm_secret(
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

  perform realtime.send(
    jsonb_build_object(
      'requestId', p_request_id,
      'accountVersion', v_next_version,
      'secretId', v_entry.secret_id,
      'revision', v_entry.revision,
      'archivedAt', v_entry.archived_at
    ),
    'helm_secrets_changed',
    'helm:account:' || v_user_id::text,
    true
  );

  return v_result;
end;
$$;

create or replace function public.set_helm_secret_archived(
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

  perform realtime.send(
    jsonb_build_object(
      'requestId', p_request_id,
      'accountVersion', v_next_version,
      'secretId', v_entry.secret_id,
      'revision', v_entry.revision,
      'archivedAt', v_entry.archived_at
    ),
    'helm_secrets_changed',
    'helm:account:' || v_user_id::text,
    true
  );

  return v_result;
end;
$$;

revoke execute on function public.list_helm_secrets() from public, anon;
revoke execute on function public.reveal_helm_secret(uuid) from public, anon;
revoke execute on function public.save_helm_secret(
  uuid, uuid, text, text, text, text[], text, text, text, text, text
) from public, anon;
revoke execute on function public.set_helm_secret_archived(uuid, uuid, boolean) from public, anon;

grant execute on function public.list_helm_secrets() to authenticated;
grant execute on function public.reveal_helm_secret(uuid) to authenticated;
grant execute on function public.save_helm_secret(
  uuid, uuid, text, text, text, text[], text, text, text, text, text
) to authenticated;
grant execute on function public.set_helm_secret_archived(uuid, uuid, boolean) to authenticated;

commit;
