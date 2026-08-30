begin;

create table if not exists public.github_life_hero_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  github_user_id bigint not null,
  selected_repository_ids bigint[] not null default '{}'::bigint[],
  vault_secret_id uuid not null unique,
  api_version text not null default '2022-11-28',
  installation_id bigint,
  authorized_at timestamptz not null default timezone('utc', now()),
  last_sync_at timestamptz,
  last_sync_status text not null default 'never_synced',
  last_sync_error_code text,
  last_sync_error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint github_life_hero_selected_repositories_bounded check (
    cardinality(selected_repository_ids) <= 25
    and array_position(selected_repository_ids, null) is null
  ),
  constraint github_life_hero_sync_status_check check (
    last_sync_status = any(array[
      'never_synced', 'success', 'empty', 'rate_limited', 'needs_reconnect',
      'revoked', 'unavailable', 'partial_sync', 'unsupported', 'error'
    ])
  )
);

create table if not exists public.github_life_hero_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  installation_id bigint,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists github_life_hero_oauth_states_user_idx
  on public.github_life_hero_oauth_states (user_id, created_at desc);

alter table public.github_life_hero_connections enable row level security;
alter table public.github_life_hero_oauth_states enable row level security;
revoke all on public.github_life_hero_connections from public, anon, authenticated;
revoke all on public.github_life_hero_oauth_states from public, anon, authenticated;

create or replace function helm_private.delete_github_life_hero_vault_value()
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

revoke execute on function helm_private.delete_github_life_hero_vault_value() from public, anon, authenticated;
drop trigger if exists github_life_hero_delete_vault_value on public.github_life_hero_connections;
create trigger github_life_hero_delete_vault_value
before delete on public.github_life_hero_connections
for each row execute function helm_private.delete_github_life_hero_vault_value();

create or replace function helm_private.guard_github_trusted_life_hero_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.evidence_type = 'craft_practice'
    and new.source_tier = 'trusted_integration'
    and coalesce(current_setting('helm.github_life_hero_verified', true), '') <> 'true'
  then
    raise exception 'Trusted GitHub Craft evidence must come from the hosted verification route.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function helm_private.guard_github_trusted_life_hero_evidence() from public, anon, authenticated;
drop trigger if exists guard_github_trusted_life_hero_evidence on public.life_hero_evidence;
create constraint trigger guard_github_trusted_life_hero_evidence
after insert on public.life_hero_evidence
deferrable initially immediate
for each row execute function helm_private.guard_github_trusted_life_hero_evidence();

create or replace function public.save_github_life_hero_credential(
  p_user_id uuid,
  p_github_user_id bigint,
  p_access_token text,
  p_refresh_token text,
  p_access_token_expires_at timestamptz,
  p_refresh_token_expires_at timestamptz,
  p_installation_id bigint,
  p_api_version text default '2022-11-28'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '3s'
as $$
declare
  v_existing public.github_life_hero_connections%rowtype;
  v_vault_secret_id uuid;
  v_secret_payload jsonb;
  v_connection public.github_life_hero_connections%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'GitHub Life Hero credentials are server-only.' using errcode = '42501';
  end if;
  if p_user_id is null or p_github_user_id is null
    or nullif(btrim(coalesce(p_access_token, '')), '') is null
    or nullif(btrim(coalesce(p_refresh_token, '')), '') is null
  then
    raise exception 'GitHub authorization did not return the required expiring credentials.' using errcode = '22023';
  end if;
  if p_api_version is null or p_api_version <> btrim(p_api_version) or length(p_api_version) > 32 then
    raise exception 'The GitHub API version is invalid.' using errcode = '22023';
  end if;

  select * into v_existing
  from public.github_life_hero_connections
  where user_id = p_user_id
  for update;

  v_secret_payload := jsonb_build_object(
    'accessToken', p_access_token,
    'refreshToken', p_refresh_token,
    'accessTokenExpiresAt', p_access_token_expires_at,
    'refreshTokenExpiresAt', p_refresh_token_expires_at
  );

  if not found then
    select vault.create_secret(
      v_secret_payload::text,
      'github-life-hero:' || p_user_id::text,
      ''
    ) into v_vault_secret_id;

    insert into public.github_life_hero_connections (
      user_id, github_user_id, vault_secret_id, api_version, installation_id
    ) values (
      p_user_id, p_github_user_id, v_vault_secret_id, p_api_version, p_installation_id
    ) returning * into v_connection;
  else
    perform vault.update_secret(v_existing.vault_secret_id, v_secret_payload::text, null, null, null);
    update public.github_life_hero_connections
    set github_user_id = p_github_user_id,
        api_version = p_api_version,
        installation_id = coalesce(p_installation_id, installation_id),
        updated_at = timezone('utc', now())
    where user_id = p_user_id
    returning * into v_connection;
  end if;

  return jsonb_build_object(
    'githubUserId', v_connection.github_user_id,
    'selectedRepositoryIds', v_connection.selected_repository_ids,
    'apiVersion', v_connection.api_version,
    'installationId', v_connection.installation_id,
    'authorizedAt', v_connection.authorized_at,
    'lastSyncAt', v_connection.last_sync_at,
    'lastSyncStatus', v_connection.last_sync_status,
    'lastSyncErrorCode', v_connection.last_sync_error_code,
    'lastSyncErrorMessage', v_connection.last_sync_error_message
  );
end;
$$;

create or replace function public.get_github_life_hero_credential(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_connection public.github_life_hero_connections%rowtype;
  v_secret jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'GitHub Life Hero credentials are server-only.' using errcode = '42501';
  end if;
  select * into v_connection
  from public.github_life_hero_connections
  where user_id = p_user_id;
  if not found then return null; end if;

  select decrypted_secret::jsonb into v_secret
  from vault.decrypted_secrets
  where id = v_connection.vault_secret_id;
  if not found or jsonb_typeof(v_secret) <> 'object' then
    raise exception 'The encrypted GitHub credential is unavailable.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'accessToken', v_secret ->> 'accessToken',
    'refreshToken', v_secret ->> 'refreshToken',
    'accessTokenExpiresAt', v_secret ->> 'accessTokenExpiresAt',
    'refreshTokenExpiresAt', v_secret ->> 'refreshTokenExpiresAt',
    'githubUserId', v_connection.github_user_id,
    'selectedRepositoryIds', v_connection.selected_repository_ids,
    'apiVersion', v_connection.api_version,
    'installationId', v_connection.installation_id,
    'authorizedAt', v_connection.authorized_at,
    'lastSyncAt', v_connection.last_sync_at,
    'lastSyncStatus', v_connection.last_sync_status,
    'lastSyncErrorCode', v_connection.last_sync_error_code,
    'lastSyncErrorMessage', v_connection.last_sync_error_message
  );
end;
$$;

create or replace function public.set_github_life_hero_selection(
  p_user_id uuid,
  p_repository_ids bigint[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '3s'
as $$
declare
  v_connection public.github_life_hero_connections%rowtype;
  v_repository_ids bigint[] := coalesce(p_repository_ids, '{}'::bigint[]);
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'GitHub Life Hero connection state is server-only.' using errcode = '42501';
  end if;
  if cardinality(v_repository_ids) > 25 or array_position(v_repository_ids, null) is not null then
    raise exception 'Select no more than 25 GitHub repositories.' using errcode = '22023';
  end if;
  update public.github_life_hero_connections
  set selected_repository_ids = v_repository_ids,
      updated_at = timezone('utc', now())
  where user_id = p_user_id
  returning * into v_connection;
  if not found then
    raise exception 'The GitHub App connection is unavailable.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'githubUserId', v_connection.github_user_id,
    'selectedRepositoryIds', v_connection.selected_repository_ids,
    'apiVersion', v_connection.api_version,
    'installationId', v_connection.installation_id,
    'authorizedAt', v_connection.authorized_at,
    'lastSyncAt', v_connection.last_sync_at,
    'lastSyncStatus', v_connection.last_sync_status,
    'lastSyncErrorCode', v_connection.last_sync_error_code,
    'lastSyncErrorMessage', v_connection.last_sync_error_message
  );
end;
$$;

create or replace function public.mark_github_life_hero_sync(
  p_user_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  v_connection public.github_life_hero_connections%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'GitHub Life Hero connection state is server-only.' using errcode = '42501';
  end if;
  if p_status is null or p_status <> btrim(p_status) or not (p_status = any(array[
    'never_synced', 'success', 'empty', 'rate_limited', 'needs_reconnect',
    'revoked', 'unavailable', 'partial_sync', 'unsupported', 'error'
  ])) then
    raise exception 'The GitHub sync status is invalid.' using errcode = '22023';
  end if;
  if p_error_code is not null and length(p_error_code) > 64 then
    raise exception 'The GitHub sync error code is too long.' using errcode = '22023';
  end if;
  if p_error_message is not null and length(p_error_message) > 512 then
    raise exception 'The GitHub sync diagnostic is too long.' using errcode = '22023';
  end if;
  update public.github_life_hero_connections
  set last_sync_at = timezone('utc', now()),
      last_sync_status = p_status,
      last_sync_error_code = nullif(p_error_code, ''),
      last_sync_error_message = nullif(p_error_message, ''),
      updated_at = timezone('utc', now())
  where user_id = p_user_id
  returning * into v_connection;
  if not found then return null; end if;
  return jsonb_build_object(
    'githubUserId', v_connection.github_user_id,
    'selectedRepositoryIds', v_connection.selected_repository_ids,
    'apiVersion', v_connection.api_version,
    'installationId', v_connection.installation_id,
    'authorizedAt', v_connection.authorized_at,
    'lastSyncAt', v_connection.last_sync_at,
    'lastSyncStatus', v_connection.last_sync_status,
    'lastSyncErrorCode', v_connection.last_sync_error_code,
    'lastSyncErrorMessage', v_connection.last_sync_error_message
  );
end;
$$;

create or replace function public.delete_github_life_hero_connection(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'GitHub Life Hero connection state is server-only.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.github_life_hero_connections where user_id = p_user_id) then return false; end if;
  delete from public.github_life_hero_connections where user_id = p_user_id;
  delete from public.github_life_hero_oauth_states where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.accept_github_life_hero_evidence(
  p_user_id uuid,
  p_candidates jsonb,
  p_as_of_local_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '3s'
as $$
declare
  v_previous_claims text := current_setting('request.jwt.claims', true);
  v_candidate jsonb;
  v_receipt jsonb;
  v_accepted integer := 0;
  v_duplicates integer := 0;
  v_snapshot jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'GitHub Life Hero evidence is server-only.' using errcode = '42501';
  end if;
  if p_user_id is null or p_as_of_local_date is null
    or jsonb_typeof(p_candidates) <> 'array'
    or jsonb_array_length(p_candidates) > 500
  then
    raise exception 'GitHub Life Hero evidence batch is invalid.' using errcode = '22023';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id::text, 'role', 'authenticated', 'is_anonymous', false)::text,
    true
  );
  perform set_config('helm.github_life_hero_verified', 'true', true);
  for v_candidate in select value from jsonb_array_elements(p_candidates) loop
    if jsonb_typeof(v_candidate) <> 'object' then
      raise exception 'GitHub Life Hero evidence candidates must be objects.' using errcode = '22023';
    end if;
    v_receipt := public.accept_life_hero_evidence(
      v_candidate ->> 'idempotencyKey',
      'craft_practice',
      'trusted_integration',
      v_candidate ->> 'sourceReference',
      (v_candidate ->> 'occurredAt')::timestamptz,
      (v_candidate ->> 'localDate')::date,
      coalesce(v_candidate -> 'metadata', '{}'::jsonb)
    );
    if (v_receipt ->> 'duplicate')::boolean then
      v_duplicates := v_duplicates + 1;
    else
      v_accepted := v_accepted + 1;
    end if;
  end loop;
  v_snapshot := public.get_life_hero_snapshot(p_as_of_local_date);
  perform set_config('request.jwt.claims', coalesce(v_previous_claims, ''), true);
  return jsonb_build_object(
    'accepted', v_accepted,
    'duplicates', v_duplicates,
    'snapshot', v_snapshot
  );
end;
$$;

revoke execute on function public.save_github_life_hero_credential(
  uuid, bigint, text, text, timestamptz, timestamptz, bigint, text
) from public, anon, authenticated;
revoke execute on function public.get_github_life_hero_credential(uuid) from public, anon, authenticated;
revoke execute on function public.set_github_life_hero_selection(uuid, bigint[]) from public, anon, authenticated;
revoke execute on function public.mark_github_life_hero_sync(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.delete_github_life_hero_connection(uuid) from public, anon, authenticated;
revoke execute on function public.accept_github_life_hero_evidence(uuid, jsonb, date) from public, anon, authenticated;
grant execute on function public.save_github_life_hero_credential(
  uuid, bigint, text, text, timestamptz, timestamptz, bigint, text
) to service_role;
grant execute on function public.get_github_life_hero_credential(uuid) to service_role;
grant execute on function public.set_github_life_hero_selection(uuid, bigint[]) to service_role;
grant execute on function public.mark_github_life_hero_sync(uuid, text, text, text) to service_role;
grant execute on function public.delete_github_life_hero_connection(uuid) to service_role;
grant execute on function public.accept_github_life_hero_evidence(uuid, jsonb, date) to service_role;

commit;
