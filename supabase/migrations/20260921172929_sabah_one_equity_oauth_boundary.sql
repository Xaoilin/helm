begin;

-- Equity approvals are independent from Inventory and Employment; no OAuth SELECT policy
-- is added to helm_records. Agents can only use the semantic RPCs below.
create table public.helm_equity_oauth_clients (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (client_id = btrim(client_id) and length(client_id) between 1 and 512),
  client_name text not null check (client_name = btrim(client_name) and length(client_name) between 1 and 160),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
create table public.helm_equity_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_fingerprint text not null,
  result jsonb,
  applied_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.helm_equity_oauth_clients enable row level security;
alter table public.helm_equity_mutation_receipts enable row level security;
revoke all on public.helm_equity_oauth_clients from public, anon, authenticated;
revoke all on public.helm_equity_mutation_receipts from public, anon, authenticated;

create function helm_private.require_equity_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id text := nullif((select auth.jwt() ->> 'client_id'), '');
begin
  if v_user_id is null or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if v_client_id is not null and not exists (
    select 1 from public.helm_equity_oauth_clients
    where user_id = v_user_id and client_id = v_client_id and revoked_at is null
  ) then
    raise exception 'This OAuth client is not approved for Sabah One Equity.' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

-- Full, bounded position drafts prevent ambiguous partial changes to grant and
-- plan lists. Both browser and OAuth edits require the latest updatedAt value.
create function helm_private.validate_equity_payload(p_value jsonb, p_kind text default 'position')
returns void language plpgsql immutable set search_path = '' as $$
declare
  v_required text[];
  v_allowed text[];
  v_key text;
  v_text text;
  v_type text;
  v_child_kind text;
  v_entry jsonb;
  v_number numeric;
  v_date date;
begin
  case p_kind
    when 'position' then
      v_required := array['id','company','asOf','ownedShares','stockPlan','optionPlan','employmentNote','grants','actions','details','sources','scenario','createdAt','updatedAt'];
      v_allowed := v_required;
    when 'plan' then
      v_required := array['summary','status','waitingFor','nextAction']; v_allowed := v_required || array['reviewMonth'];
    when 'grant' then
      v_required := array['id','grantDate','vested','unvested','strikeUsd','originalExpiry']; v_allowed := v_required || array['postEmploymentExpiry','nextVest'];
    when 'vest' then
      v_required := array['date','quantity','condition']; v_allowed := v_required || array['alternateDate'];
    when 'action' then
      v_required := array['id','title','timing','done']; v_allowed := v_required || array['dueDate'];
    when 'detail' then
      v_required := array['id','title','body']; v_allowed := v_required;
    when 'source' then
      v_required := array['id','label','url','asOf']; v_allowed := v_required;
    when 'scenario' then
      v_required := array['pricesUsd','withholdingRate','usdToGbp','asOf','notes']; v_allowed := v_required;
    else raise exception 'Unknown Equity object.' using errcode = '22023';
  end case;
  if jsonb_typeof(p_value) is distinct from 'object' or not (p_value ?& v_required) then
    raise exception 'Equity % is missing required fields.', p_kind using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_value) loop
    if not (v_key = any(v_allowed)) then
      raise exception 'Unsupported Equity field: %.', v_key using errcode = '22023';
    end if;
    v_type := jsonb_typeof(p_value -> v_key);
    v_text := p_value ->> v_key;
    if v_key in ('stockPlan','optionPlan','nextVest','scenario') then
      v_child_kind := case v_key when 'stockPlan' then 'plan' when 'optionPlan' then 'plan' when 'nextVest' then 'vest' else 'scenario' end;
      perform helm_private.validate_equity_payload(p_value -> v_key, v_child_kind);
    elsif v_key in ('grants','actions','details','sources','pricesUsd') then
      if v_type is distinct from 'array' then
        raise exception 'Equity % must be an array.', v_key using errcode = '22023';
      end if;
      if jsonb_array_length(p_value -> v_key) > (case when v_key='pricesUsd' then 20 else 100 end) then
        raise exception 'Equity % exceeds its entry limit.', v_key using errcode = '22023';
      end if;
      for v_entry in select value from jsonb_array_elements(p_value -> v_key) loop
        if v_key='pricesUsd' then
          if jsonb_typeof(v_entry) is distinct from 'number' then
            raise exception 'Equity scenario prices must be nonnegative finite numbers.' using errcode = '22023';
          end if;
          if v_entry::numeric < 0 or v_entry::numeric > 1000000000000 then
            raise exception 'Equity scenario prices must be nonnegative finite numbers.' using errcode = '22023';
          end if;
        else
          v_child_kind := case v_key when 'grants' then 'grant' when 'actions' then 'action' when 'details' then 'detail' else 'source' end;
          perform helm_private.validate_equity_payload(v_entry, v_child_kind);
        end if;
      end loop;
      if v_key <> 'pricesUsd' and exists (select 1 from jsonb_array_elements(p_value -> v_key) entry group by entry ->> 'id' having count(*) > 1) then
        raise exception 'Equity % contains duplicate IDs.', v_key using errcode = '22023';
      end if;
    elsif v_key in ('ownedShares','vested','unvested','quantity','strikeUsd','withholdingRate','usdToGbp') then
      if v_type is distinct from 'number' then
        raise exception 'Equity % must be a bounded number.', v_key using errcode = '22023';
      end if;
      v_number := v_text::numeric;
      if v_number < 0 or v_number > 1000000000000
        or (v_key in ('ownedShares','vested','unvested','quantity') and trunc(v_number) <> v_number)
        or (v_key='withholdingRate' and v_number > 1)
        or (v_key='usdToGbp' and (v_number <= 0 or v_number > 1000000)) then
        raise exception 'Equity % must be a bounded number.', v_key using errcode = '22023';
      end if;
    elsif v_key='done' then
      if v_type is distinct from 'boolean' then raise exception 'Equity done must be a boolean.' using errcode = '22023'; end if;
    else
      if v_type is distinct from 'string' or length(v_text) > (case
        when v_key='id' then 256 when v_key='company' then 200 when v_key='url' then 2048
        when v_key in ('body','notes','employmentNote') then 16000 else 4000 end) then
        raise exception 'Equity % must be bounded text.', v_key using errcode = '22023';
      end if;
      if v_key in ('id','company','title','label') and (v_text='' or v_text<>btrim(v_text)) then
        raise exception 'Equity % requires trimmed nonempty text.', v_key using errcode = '22023';
      end if;
      if v_key='status' and not (v_text=any(array['agreed','tentative','undecided'])) then
        raise exception 'Equity plan status is invalid.' using errcode = '22023';
      end if;
      if v_key='url' and (v_text !~ '^https?://[^[:space:]/]+[^[:space:]]*$' or v_text ~ '^https?://[^/]*@') then
        raise exception 'Equity sources require HTTP or HTTPS URLs without credentials.' using errcode = '22023';
      end if;
      if v_key='reviewMonth' then
        if v_text !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(v_text,4)='0000' then
          raise exception 'Equity review month must be YYYY-MM.' using errcode = '22023';
        end if;
      elsif v_key in ('asOf','grantDate','originalExpiry','postEmploymentExpiry','date','alternateDate','dueDate') then
        if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'Equity dates must be valid YYYY-MM-DD dates.' using errcode = '22023';
        end if;
        begin v_date:=v_text::date;
        exception when datetime_field_overflow or invalid_datetime_format then
          raise exception 'Equity dates must be valid YYYY-MM-DD dates.' using errcode = '22023';
        end;
        if to_char(v_date,'YYYY-MM-DD')<>v_text then
          raise exception 'Equity dates must be valid YYYY-MM-DD dates.' using errcode = '22023';
        end if;
      end if;
    end if;
  end loop;
end;
$$;

create function public.equity_list_positions(p_query text default '', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user_id uuid; v_result jsonb;
begin
  v_user_id := helm_private.require_equity_actor();
  if length(coalesce(p_query,'')) > 160 or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'Equity search bounds are invalid.' using errcode = '22023';
  end if;
  with matched as (
    select record_id, payload from public.helm_records where user_id=v_user_id
      and collection='equityPositions' and deleted_at is null
      and (coalesce(p_query,'')='' or strpos(lower(payload->>'company'),lower(p_query))>0)
  ), page as (select * from matched order by record_id limit p_limit offset p_offset)
  select jsonb_build_object('positions',coalesce((select jsonb_agg(payload order by record_id) from page),'[]'::jsonb),
    'total',(select count(*) from matched),'offset',p_offset,'limit',p_limit) into v_result;
  return v_result;
end;
$$;

create function public.equity_get_position(p_position_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user_id uuid; v_position jsonb;
begin
  v_user_id := helm_private.require_equity_actor();
  if p_position_id is null or length(p_position_id) not between 1 and 256 then
    raise exception 'A bounded Equity position id is required.' using errcode = '22023';
  end if;
  select payload into v_position from public.helm_records where user_id=v_user_id
    and collection='equityPositions' and record_id=p_position_id and deleted_at is null;
  if not found then raise exception 'Equity position was not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('position',v_position);
end;
$$;

create function helm_private.mutate_equity(p_request_id uuid,p_action text,p_position_id text,p_input jsonb,p_expected_updated_at text default null)
returns jsonb language plpgsql security definer set search_path = ''
set statement_timeout = '10s' set lock_timeout = '3s' as $$
declare
  v_user_id uuid;
  v_fingerprint text;
  v_existing_fingerprint text;
  v_claimed boolean;
  v_result jsonb;
  v_record public.helm_records%rowtype;
  v_position jsonb;
  v_version bigint;
  v_id text;
  v_now timestamptz;
begin
  -- Recheck approval before idempotency receipts: revoked clients cannot retry.
  v_user_id:=helm_private.require_equity_actor();
  if p_request_id is null or jsonb_typeof(p_input) is distinct from 'object'
    or octet_length(p_input::text)>262144 or not coalesce(p_action=any(array['add','update','remove']),false)
    or (p_action<>'add' and (p_position_id is null or length(p_position_id) not between 1 and 256
      or p_expected_updated_at is null or length(p_expected_updated_at) not between 1 and 64)) then
    raise exception 'Equity mutation requires bounded input and the latest updatedAt for edits.' using errcode = '22023';
  end if;
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('clientId',auth.jwt()->>'client_id',
    'action',p_action,'positionId',p_position_id,'input',p_input,'expectedUpdatedAt',p_expected_updated_at)::text,'sha256'),'hex');
  insert into public.helm_equity_mutation_receipts(user_id,request_id,request_fingerprint)
    values(v_user_id,p_request_id,v_fingerprint) on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed,false) then
    select request_fingerprint,result into v_existing_fingerprint,v_result
      from public.helm_equity_mutation_receipts where user_id=v_user_id and request_id=p_request_id;
    if v_fingerprint is distinct from v_existing_fingerprint then
      raise exception 'Equity idempotency key was reused with different arguments or client.' using errcode = '22023';
    end if;
    if v_result is null then raise exception 'Equity mutation is still being committed.' using errcode = '40001'; end if;
    return v_result;
  end if;
  insert into public.helm_account_state(user_id) values(v_user_id) on conflict do nothing;
  select account_version into v_version from public.helm_account_state where user_id=v_user_id for update;
  v_id:=case when p_action='add' then coalesce(p_input->>'id',gen_random_uuid()::text) else p_position_id end;
  select * into v_record from public.helm_records where user_id=v_user_id and collection='equityPositions' and record_id=v_id for update;
  if p_action='add' then
    if found then raise exception 'Equity position id already exists; use a new id or update the existing position.' using errcode = '23505'; end if;
    if (select count(*) from public.helm_records where user_id=v_user_id and collection='equityPositions' and deleted_at is null)>=1000 then
      raise exception 'Equity position limit reached.' using errcode = '22023';
    end if;
  else
    if not found or v_record.deleted_at is not null then raise exception 'Equity position was not found.' using errcode = 'P0002'; end if;
    if p_expected_updated_at is distinct from v_record.payload->>'updatedAt' then
      raise exception 'Equity position changed; reload before saving.' using errcode = '40001';
    end if;
  end if;
  v_now:=clock_timestamp();
  if p_action='remove' then
    if p_input is distinct from '{"confirm":true}'::jsonb then
      raise exception 'Equity removal requires explicit confirmation.' using errcode = '22023';
    end if;
    v_position:=v_record.payload;
  else
    if p_input ? 'createdAt' or p_input ? 'updatedAt' or (p_action='update' and p_input ? 'id') then
      raise exception 'Equity identity and lifecycle timestamps are assigned by the server.' using errcode = '22023';
    end if;
    v_position:=p_input || jsonb_build_object('id',v_id,'createdAt',case when p_action='add' then to_jsonb(v_now) else v_record.payload->'createdAt' end,'updatedAt',v_now);
    perform helm_private.validate_equity_payload(v_position);
  end if;
  v_version:=v_version+1;
  insert into public.helm_records(user_id,collection,record_id,payload,revision,account_version,updated_at,deleted_at)
    values(v_user_id,'equityPositions',v_id,v_position,1,v_version,v_now,case when p_action='remove' then v_now else null end)
    on conflict(user_id,collection,record_id) do update set payload=excluded.payload,
      revision=helm_records.revision+1,account_version=v_version,updated_at=v_now,deleted_at=excluded.deleted_at
    returning * into v_record;
  update public.helm_account_state set account_version=v_version,updated_at=v_now where user_id=v_user_id;
  perform realtime.send(jsonb_build_object('requestId',p_request_id,'accountVersion',v_version,
    'changes',jsonb_build_array(jsonb_build_object('collection','equityPositions','recordId',v_id,'revision',v_record.revision,'deletedAt',v_record.deleted_at))),
    'helm_records_changed','helm:account:' || v_user_id::text,true);
  v_result:=jsonb_build_object('positionId',v_id,'position',case when p_action='remove' then null else v_position end,'accountVersion',v_version);
  update public.helm_equity_mutation_receipts set result=v_result,applied_at=v_now where user_id=v_user_id and request_id=p_request_id;
  return v_result;
end;
$$;

create function public.equity_add_position(p_request_id uuid,p_position jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select helm_private.mutate_equity(p_request_id,'add',null,p_position);
$$;
create function public.equity_update_position(p_request_id uuid,p_position_id text,p_position jsonb,p_expected_updated_at text)
returns jsonb language sql security definer set search_path = '' as $$
  select helm_private.mutate_equity(p_request_id,'update',p_position_id,p_position,p_expected_updated_at);
$$;
create function public.equity_remove_position(p_request_id uuid,p_position_id text,p_confirm boolean,p_expected_updated_at text)
returns jsonb language sql security definer set search_path = '' as $$
  select helm_private.mutate_equity(p_request_id,'remove',p_position_id,jsonb_build_object('confirm',p_confirm),p_expected_updated_at);
$$;
create function public.list_equity_oauth_clients()
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
  into v_clients from public.helm_equity_oauth_clients where user_id = v_user_id;
  return v_clients;
end;
$$;

create function public.approve_equity_oauth_client(p_client_id text, p_client_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_client public.helm_equity_oauth_clients%rowtype;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  if p_client_id is null or p_client_id <> btrim(p_client_id) or length(p_client_id) not between 1 and 512
    or p_client_name is null or p_client_name <> btrim(p_client_name) or length(p_client_name) not between 1 and 160 then
    raise exception 'OAuth client identity is invalid.' using errcode = '22023';
  end if;
  insert into public.helm_equity_oauth_clients (
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

create function public.revoke_equity_oauth_client(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_client public.helm_equity_oauth_clients%rowtype;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  if p_client_id is null or p_client_id <> btrim(p_client_id)
    or length(p_client_id) not between 1 and 512 then
    raise exception 'OAuth client identity is invalid.' using errcode = '22023';
  end if;
  update public.helm_equity_oauth_clients set revoked_at = now(), updated_at = now()
  where user_id = v_user_id and client_id = p_client_id
  returning * into v_client;
  if not found then raise exception 'Approved OAuth client was not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'clientId', v_client.client_id, 'clientName', v_client.client_name,
    'approvedAt', v_client.approved_at, 'revokedAt', v_client.revoked_at
  );
end;
$$;



revoke execute on function helm_private.require_equity_actor() from public, anon, authenticated;
revoke execute on function helm_private.validate_equity_payload(jsonb,text) from public, anon, authenticated;
revoke execute on function helm_private.mutate_equity(uuid,text,text,jsonb,text) from public, anon, authenticated;
revoke all on function public.equity_list_positions(text,integer,integer) from public, anon;
grant execute on function public.equity_list_positions(text,integer,integer) to authenticated;
revoke all on function public.equity_get_position(text) from public, anon;
grant execute on function public.equity_get_position(text) to authenticated;
revoke all on function public.equity_add_position(uuid,jsonb) from public, anon;
grant execute on function public.equity_add_position(uuid,jsonb) to authenticated;
revoke all on function public.equity_update_position(uuid,text,jsonb,text) from public, anon;
grant execute on function public.equity_update_position(uuid,text,jsonb,text) to authenticated;
revoke all on function public.equity_remove_position(uuid,text,boolean,text) from public, anon;
grant execute on function public.equity_remove_position(uuid,text,boolean,text) to authenticated;
revoke all on function public.list_equity_oauth_clients() from public, anon;
grant execute on function public.list_equity_oauth_clients() to authenticated;
revoke all on function public.approve_equity_oauth_client(text,text) from public, anon;
grant execute on function public.approve_equity_oauth_client(text,text) to authenticated;
revoke all on function public.revoke_equity_oauth_client(text) from public, anon;
grant execute on function public.revoke_equity_oauth_client(text) to authenticated;

commit;
