begin;

-- Employment approvals are independent from Inventory; no OAuth SELECT policy
-- is added to helm_records. Agents can only use the semantic RPCs below.
create table public.helm_employment_oauth_clients (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (client_id = btrim(client_id) and length(client_id) between 1 and 512),
  client_name text not null check (client_name = btrim(client_name) and length(client_name) between 1 and 160),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
create table public.helm_employment_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_fingerprint text not null,
  result jsonb,
  applied_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.helm_employment_oauth_clients enable row level security;
alter table public.helm_employment_mutation_receipts enable row level security;
revoke all on public.helm_employment_oauth_clients from public, anon, authenticated;
revoke all on public.helm_employment_mutation_receipts from public, anon, authenticated;

create function helm_private.require_employment_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id text := nullif((select auth.jwt() ->> 'client_id'), '');
begin
  if v_user_id is null or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if v_client_id is not null and not exists (
    select 1 from public.helm_employment_oauth_clients
    where user_id = v_user_id and client_id = v_client_id and revoked_at is null
  ) then
    raise exception 'This OAuth client is not approved for Sabah One Employment.' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

-- Validate the narrow domain contract, including actual calendar dates and
-- HTTPS/HTTP evidence links. App-owned IDs and timestamps cannot be patched.
create function helm_private.validate_employment_payload(p_value jsonb, p_history boolean default false)
returns void language plpgsql immutable set search_path = '' as $$
declare
  v_key text;
  v_text text;
  v_max integer;
  v_date date;
  v_entry jsonb;
  v_allowed text[];
begin
  if jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'Employment data must be an object.' using errcode = '22023';
  end if;
  v_allowed := case when p_history then array['id','kind','date','summary','details','evidenceUrl'] else
    array['id','company','role','url','workType','remoteRegion','remoteStatus','remoteEvidence','remoteCaveat',
      'compensation','status','applicationDate','nextAction','nextActionDate','notes','history','createdAt','updatedAt'] end;
  for v_key in select jsonb_object_keys(p_value) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'Unsupported Employment field: %.', v_key using errcode = '22023';
    end if;
    if v_key = 'history' then continue; end if;
    v_text := p_value ->> v_key;
    v_max := case when v_key in ('id','company','role') then 256
      when v_key in ('url','evidenceUrl') then 2048
      when v_key in ('notes','details','remoteEvidence') then 10000 else 2000 end;
    if jsonb_typeof(p_value -> v_key) is distinct from 'string' or length(v_text) > v_max then
      raise exception 'Employment field % must be bounded text.', v_key using errcode = '22023';
    end if;
    if v_key in ('id','company','role','summary') and (v_text <> btrim(v_text) or v_text = '') then
      raise exception 'Employment field % must contain trimmed text.', v_key using errcode = '22023';
    end if;
    if v_key in ('url','evidenceUrl') and (v_text !~ '^https?://[^[:space:]/]+[^[:space:]]*$' or v_text ~ '^https?://[^/]*@') then
      raise exception 'Employment links must use HTTP or HTTPS.' using errcode = '22023';
    end if;
    if v_key in ('date','applicationDate','nextActionDate') then
      if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Employment dates must be valid YYYY-MM-DD dates.' using errcode = '22023';
      end if;
      begin v_date := v_text::date;
      exception when datetime_field_overflow or invalid_datetime_format then
        raise exception 'Employment dates must be valid YYYY-MM-DD dates.' using errcode = '22023';
      end;
      if to_char(v_date,'YYYY-MM-DD') <> v_text then
        raise exception 'Employment dates must be valid YYYY-MM-DD dates.' using errcode = '22023';
      end if;
    end if;
  end loop;
  if p_history then
    if not (p_value ?& array['id','kind','summary','details']) or not coalesce(
      p_value ->> 'kind' = any(array['application','contact','document','remote_evidence','note']), false) then
      raise exception 'Employment history requires id, valid kind, summary, and details.' using errcode = '22023';
    end if;
  else
    if not (p_value ?& array['id','company','role','workType','remoteRegion','remoteStatus',
      'remoteEvidence','status','nextAction','notes','history','createdAt','updatedAt'])
      or not coalesce(p_value ->> 'workType' = any(array['contract','permanent','unknown']), false)
      or not coalesce(p_value ->> 'remoteRegion' = any(array['uk','emea','global','unknown']), false)
      or not coalesce(p_value ->> 'remoteStatus' = any(array['confirmed','needs_verification']), false)
      or not coalesce(p_value ->> 'status' = any(array['lead','recruiter','applied','interview','offer','closed']), false) then
      raise exception 'Employment application fields or status are invalid.' using errcode = '22023';
    end if;
    if btrim(p_value ->> 'remoteEvidence') = '' or btrim(p_value ->> 'nextAction') = ''
      or (p_value ->> 'remoteStatus' = 'confirmed' and p_value ->> 'remoteRegion' = 'unknown') then
      raise exception 'Employment requires a next action and accurate remote eligibility evidence.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_value -> 'history') is distinct from 'array' or jsonb_array_length(p_value -> 'history') > 1000 then
      raise exception 'Employment history must be an array of at most 1000 entries.' using errcode = '22023';
    end if;
    for v_entry in select value from jsonb_array_elements(p_value -> 'history') loop
      perform helm_private.validate_employment_payload(v_entry, true);
    end loop;
    if exists (select 1 from jsonb_array_elements(p_value -> 'history') entry
      group by entry ->> 'id' having count(*) > 1) or exists (
      select 1 from jsonb_array_elements(p_value -> 'history') entry where entry ? 'evidenceUrl'
      group by entry ->> 'evidenceUrl' having count(*) > 1) then
      raise exception 'Employment history contains duplicate IDs or evidence links.' using errcode = '22023';
    end if;
  end if;
end;
$$;

create function public.employment_list_applications(
  p_query text default '', p_status text default null, p_limit integer default 50,
  p_offset integer default 0, p_work_type text default null, p_remote_status text default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user_id uuid; v_result jsonb;
begin
  v_user_id := helm_private.require_employment_actor();
  if length(coalesce(p_query,'')) > 160 or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 10000
    or (p_status is not null and not (p_status = any(array['lead','recruiter','applied','interview','offer','closed'])))
    or (p_work_type is not null and not (p_work_type = any(array['contract','permanent','unknown'])))
    or (p_remote_status is not null and not (p_remote_status = any(array['confirmed','needs_verification']))) then
    raise exception 'Employment search bounds are invalid.' using errcode = '22023';
  end if;
  with matched as (
    select app.value as application, app.ordinality as position
    from public.helm_records record,
      lateral jsonb_array_elements(record.payload -> 'applications') with ordinality app
    where record.user_id = v_user_id and record.collection = 'employment'
      and record.record_id = 'singleton' and record.deleted_at is null
      and (coalesce(p_query,'') = '' or strpos(lower(app.value::text), lower(p_query)) > 0)
      and (p_status is null or app.value ->> 'status' = p_status)
      and (p_work_type is null or app.value ->> 'workType' = p_work_type)
      and (p_remote_status is null or app.value ->> 'remoteStatus' = p_remote_status)
  ), page as (select * from matched order by position limit p_limit offset p_offset)
  select jsonb_build_object('applications', coalesce((select jsonb_agg(application order by position) from page),'[]'::jsonb),
    'total',(select count(*) from matched),'offset',p_offset,'limit',p_limit) into v_result;
  return v_result;
end;
$$;

create function public.employment_get_application(p_application_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user_id uuid; v_application jsonb;
begin
  v_user_id := helm_private.require_employment_actor();
  if p_application_id is null or length(p_application_id) not between 1 and 256 then
    raise exception 'A bounded Employment application id is required.' using errcode = '22023';
  end if;
  select app into v_application from public.helm_records record,
    lateral jsonb_array_elements(record.payload -> 'applications') app
  where record.user_id = v_user_id and record.collection = 'employment'
    and record.record_id = 'singleton' and record.deleted_at is null and app ->> 'id' = p_application_id;
  if not found then raise exception 'Employment application was not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('application',v_application);
end;
$$;

-- An account lock is shared with first-party/Inventory writers. Read the latest
-- singleton under that lock and change only the requested application/history.
create function helm_private.mutate_employment(
  p_request_id uuid, p_action text, p_application_id text, p_input jsonb, p_expected_updated_at text default null
)
returns jsonb language plpgsql security definer set search_path = ''
set statement_timeout = '10s' set lock_timeout = '3s' as $$
declare
  v_user_id uuid;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_claimed boolean;
  v_result jsonb;
  v_record public.helm_records%rowtype;
  v_state jsonb;
  v_applications jsonb;
  v_application jsonb;
  v_history jsonb;
  v_key text;
  v_index integer;
  v_version bigint;
  v_id text;
  v_duplicate boolean := false;
  v_now timestamptz := now();
begin
  -- Approval precedes receipt lookup, so revocation also denies retries.
  v_user_id := helm_private.require_employment_actor();
  if p_request_id is null or jsonb_typeof(p_input) is distinct from 'object'
    or octet_length(p_input::text) > 262144
    or not coalesce(p_action = any(array['add','update','add_history','remove']),false)
    or (p_action <> 'add' and (p_application_id is null or length(p_application_id) not between 1 and 256)) then
    raise exception 'Employment mutation request is invalid or exceeds its bounds.' using errcode = '22023';
  end if;
  v_fingerprint := encode(extensions.digest(jsonb_build_object('clientId',auth.jwt() ->> 'client_id',
    'action',p_action,'applicationId',p_application_id,'input',p_input,'expectedUpdatedAt',p_expected_updated_at)::text,'sha256'),'hex');
  insert into public.helm_employment_mutation_receipts(user_id,request_id,request_fingerprint)
    values(v_user_id,p_request_id,v_fingerprint) on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed,false) then
    select request_fingerprint,result into v_existing_fingerprint,v_result
      from public.helm_employment_mutation_receipts where user_id=v_user_id and request_id=p_request_id;
    if v_fingerprint is distinct from v_existing_fingerprint then
      raise exception 'Employment idempotency key was reused with different arguments or client.' using errcode = '22023';
    end if;
    if v_result is null then raise exception 'Employment mutation is still being committed.' using errcode = '40001'; end if;
    return v_result;
  end if;
  insert into public.helm_account_state(user_id) values(v_user_id) on conflict do nothing;
  select account_version into v_version from public.helm_account_state where user_id=v_user_id for update;
  select * into v_record from public.helm_records where user_id=v_user_id and collection='employment'
    and record_id='singleton' for update;
  if found and v_record.deleted_at is null then v_state := v_record.payload;
  else v_state := '{"seedVersion":1,"applications":[]}'::jsonb; end if;
  if jsonb_typeof(v_state -> 'applications') is distinct from 'array' then
    raise exception 'The stored Employment tracker is invalid.' using errcode = '22023';
  end if;
  v_applications := v_state -> 'applications';
  if p_action = 'add' then
    if jsonb_array_length(v_applications) >= 10000 then
      raise exception 'Employment application limit reached.' using errcode = '22023';
    end if;
    if p_input ? 'createdAt' or p_input ? 'updatedAt' then
      raise exception 'Employment lifecycle timestamps are assigned by the server.' using errcode = '22023';
    end if;
    v_id := coalesce(p_input ->> 'id',gen_random_uuid()::text);
    v_application := jsonb_build_object('id',v_id,'workType','unknown','remoteRegion','unknown',
      'remoteStatus','needs_verification','remoteEvidence','Remote eligibility needs verification.',
      'status','lead','nextAction','Review the latest evidence and decide the next step.',
      'notes','','history','[]'::jsonb) || p_input || jsonb_build_object('createdAt',v_now,'updatedAt',v_now);
    if jsonb_typeof(v_application -> 'history') is distinct from 'array' then
      raise exception 'Employment history must be an array of at most 1000 entries.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',coalesce(entry ->> 'id',gen_random_uuid()::text),
      'details','') || entry order by position),'[]'::jsonb) into v_history
      from jsonb_array_elements(v_application -> 'history') with ordinality as entries(entry,position);
    v_application:=jsonb_set(v_application,'{history}',v_history);
    perform helm_private.validate_employment_payload(v_application);
    select app,ordinality::integer-1 into v_history,v_index
      from jsonb_array_elements(v_applications) with ordinality a(app,ordinality)
      where app ->> 'id'=v_id or (v_application ? 'url' and app ->> 'url'=v_application ->> 'url'
        and lower(app ->> 'company')=lower(v_application ->> 'company') and lower(app ->> 'role')=lower(v_application ->> 'role'))
      limit 1;
    if found then v_application:=v_history; v_duplicate:=true;
    else v_applications:=v_applications || jsonb_build_array(v_application); end if;
  else
    select app,ordinality::integer-1 into v_application,v_index
      from jsonb_array_elements(v_applications) with ordinality a(app,ordinality)
      where app ->> 'id'=p_application_id;
    if not found then raise exception 'Employment application was not found.' using errcode = 'P0002'; end if;
    if p_expected_updated_at is not null and p_expected_updated_at is distinct from v_application ->> 'updatedAt' then
      raise exception 'Employment application changed; reload before saving.' using errcode = '40001';
    end if;
    if p_action='update' then
      if p_input='{}'::jsonb then raise exception 'Employment patch must contain a field.' using errcode = '22023'; end if;
      for v_key in select jsonb_object_keys(p_input) loop
        if v_key='history' and nullif(auth.jwt() ->> 'client_id','') is null then
          if jsonb_typeof(p_input -> 'history') is distinct from 'array' or jsonb_array_length(p_input -> 'history') > 1000 then
            raise exception 'Employment history must be an array of at most 1000 entries.' using errcode = '22023';
          end if;
          for v_history in select value from jsonb_array_elements(p_input -> 'history') loop
            perform helm_private.validate_employment_payload(v_history,true);
            if not exists(select 1 from jsonb_array_elements(v_application -> 'history') entry
              where entry ->> 'id'=v_history ->> 'id'
                or (v_history ? 'evidenceUrl' and entry ->> 'evidenceUrl'=v_history ->> 'evidenceUrl')) then
              v_application:=jsonb_set(v_application,'{history}',(v_application -> 'history') || jsonb_build_array(v_history));
            end if;
          end loop;
          continue;
        end if;
        if v_key in ('id','history','createdAt','updatedAt') then
          raise exception 'Employment field % cannot be patched.',v_key using errcode = '22023';
        end if;
        if p_input -> v_key='null'::jsonb then
          if not (v_key = any(array['url','remoteCaveat','compensation','applicationDate','nextActionDate'])) then
            raise exception 'Only optional Employment fields may be cleared.' using errcode = '22023';
          end if;
          v_application:=v_application-v_key;
        else v_application:=v_application || jsonb_build_object(v_key,p_input -> v_key); end if;
      end loop;
    elsif p_action='add_history' then
      v_history:=jsonb_build_object('id',coalesce(p_input ->> 'id',gen_random_uuid()::text),'details','') || p_input;
      perform helm_private.validate_employment_payload(v_history,true);
      if exists(select 1 from jsonb_array_elements(v_application -> 'history') entry
        where entry ->> 'id'=v_history ->> 'id'
          or (v_history ? 'evidenceUrl' and entry ->> 'evidenceUrl'=v_history ->> 'evidenceUrl')) then
        v_duplicate:=true;
      else v_application:=jsonb_set(v_application,'{history}',(v_application -> 'history') || jsonb_build_array(v_history)); end if;
    else
      if p_input is distinct from '{"confirm":true}'::jsonb then
        raise exception 'Employment removal requires explicit confirmation.' using errcode = '22023';
      end if;
      v_applications:=v_applications-v_index;
    end if;
    if p_action<>'remove' and not v_duplicate then
      v_application:=v_application || jsonb_build_object('updatedAt',v_now);
      perform helm_private.validate_employment_payload(v_application);
      v_applications:=jsonb_set(v_applications,array[v_index::text],v_application);
    end if;
  end if;
  v_id:=v_application ->> 'id';
  if not v_duplicate then
    v_version:=v_version+1;
    v_state:=jsonb_set(v_state,'{applications}',v_applications);
    if octet_length(v_state::text) > 1048576 then
      raise exception 'Employment tracker exceeds its 1 MiB record bound.' using errcode = '22023';
    end if;
    insert into public.helm_records(user_id,collection,record_id,payload,revision,account_version,updated_at)
      values(v_user_id,'employment','singleton',v_state,1,v_version,v_now)
      on conflict(user_id,collection,record_id) do update set payload=excluded.payload,
        revision=helm_records.revision+1,account_version=v_version,updated_at=v_now,deleted_at=null
      returning * into v_record;
    update public.helm_account_state set account_version=v_version,updated_at=v_now where user_id=v_user_id;
    perform realtime.send(jsonb_build_object('requestId',p_request_id,'accountVersion',v_version,
      'changes',jsonb_build_array(jsonb_build_object('collection','employment','recordId','singleton',
        'revision',v_record.revision,'deletedAt',null))),
      'helm_records_changed','helm:account:' || v_user_id::text,true);
  end if;
  v_result:=jsonb_build_object('applicationId',v_id,'application',case when p_action='remove' then null else v_application end,
    'accountVersion',v_version,'duplicate',v_duplicate);
  update public.helm_employment_mutation_receipts set result=v_result,applied_at=v_now
    where user_id=v_user_id and request_id=p_request_id;
  return v_result;
end;
$$;

create function public.employment_add_application(p_request_id uuid,p_application jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select helm_private.mutate_employment(p_request_id,'add',null,p_application);
$$;
create function public.employment_update_application(p_request_id uuid,p_application_id text,p_patch jsonb,p_expected_updated_at text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select helm_private.mutate_employment(p_request_id,'update',p_application_id,p_patch,p_expected_updated_at);
$$;
create function public.employment_add_history(p_request_id uuid,p_application_id text,p_history jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select helm_private.mutate_employment(p_request_id,'add_history',p_application_id,p_history);
$$;
create function public.employment_remove_application(p_request_id uuid,p_application_id text,p_confirm boolean default false,p_expected_updated_at text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select helm_private.mutate_employment(p_request_id,'remove',p_application_id,jsonb_build_object('confirm',p_confirm),p_expected_updated_at);
$$;

create function public.list_employment_oauth_clients()
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
  into v_clients from public.helm_employment_oauth_clients where user_id = v_user_id;
  return v_clients;
end;
$$;

create function public.approve_employment_oauth_client(p_client_id text, p_client_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_client public.helm_employment_oauth_clients%rowtype;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  if p_client_id is null or p_client_id <> btrim(p_client_id) or length(p_client_id) not between 1 and 512
    or p_client_name is null or p_client_name <> btrim(p_client_name) or length(p_client_name) not between 1 and 160 then
    raise exception 'OAuth client identity is invalid.' using errcode = '22023';
  end if;
  insert into public.helm_employment_oauth_clients (
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

create function public.revoke_employment_oauth_client(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_client public.helm_employment_oauth_clients%rowtype;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  if p_client_id is null or p_client_id <> btrim(p_client_id)
    or length(p_client_id) not between 1 and 512 then
    raise exception 'OAuth client identity is invalid.' using errcode = '22023';
  end if;
  update public.helm_employment_oauth_clients set revoked_at = now(), updated_at = now()
  where user_id = v_user_id and client_id = p_client_id
  returning * into v_client;
  if not found then raise exception 'Approved OAuth client was not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'clientId', v_client.client_id, 'clientName', v_client.client_name,
    'approvedAt', v_client.approved_at, 'revokedAt', v_client.revoked_at
  );
end;
$$;


revoke execute on function helm_private.require_employment_actor() from public, anon, authenticated;
revoke execute on function helm_private.validate_employment_payload(jsonb,boolean) from public, anon, authenticated;
revoke execute on function helm_private.mutate_employment(uuid,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.employment_list_applications(text,text,integer,integer,text,text) from public, anon;
grant execute on function public.employment_list_applications(text,text,integer,integer,text,text) to authenticated;
revoke all on function public.employment_get_application(text) from public, anon;
grant execute on function public.employment_get_application(text) to authenticated;
revoke all on function public.employment_add_application(uuid,jsonb) from public, anon;
grant execute on function public.employment_add_application(uuid,jsonb) to authenticated;
revoke all on function public.employment_update_application(uuid,text,jsonb,text) from public, anon;
grant execute on function public.employment_update_application(uuid,text,jsonb,text) to authenticated;
revoke all on function public.employment_add_history(uuid,text,jsonb) from public, anon;
grant execute on function public.employment_add_history(uuid,text,jsonb) to authenticated;
revoke all on function public.employment_remove_application(uuid,text,boolean,text) from public, anon;
grant execute on function public.employment_remove_application(uuid,text,boolean,text) to authenticated;
revoke all on function public.list_employment_oauth_clients() from public, anon;
grant execute on function public.list_employment_oauth_clients() to authenticated;
revoke all on function public.approve_employment_oauth_client(text,text) from public, anon;
grant execute on function public.approve_employment_oauth_client(text,text) to authenticated;
revoke all on function public.revoke_employment_oauth_client(text) from public, anon;
grant execute on function public.revoke_employment_oauth_client(text) to authenticated;

commit;
