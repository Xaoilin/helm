begin;

-- Finance approvals are independent from Inventory, Employment and Equity; no OAuth SELECT policy
-- is added to helm_records. Agents can only use the semantic RPCs below.
create table public.helm_finance_oauth_clients (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (client_id = btrim(client_id) and length(client_id) between 1 and 512),
  client_name text not null check (client_name = btrim(client_name) and length(client_name) between 1 and 160),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
create table public.helm_finance_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  request_fingerprint text not null,
  result jsonb,
  applied_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.helm_finance_oauth_clients enable row level security;
alter table public.helm_finance_mutation_receipts enable row level security;
revoke all on public.helm_finance_oauth_clients from public, anon, authenticated;
revoke all on public.helm_finance_mutation_receipts from public, anon, authenticated;

create function helm_private.require_finance_actor()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_client_id text := nullif((select auth.jwt() ->> 'client_id'), '');
begin
  if v_user_id is null or coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if v_client_id is not null and not exists (
    select 1 from public.helm_finance_oauth_clients
    where user_id = v_user_id and client_id = v_client_id and revoked_at is null
  ) then
    raise exception 'This OAuth client is not approved for Sabah One Finance.' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

create function helm_private.validate_finance_payload(p_value jsonb, p_kind text default 'review')
returns void language plpgsql immutable set search_path = '' as $$
declare
  v_required text[]; v_allowed text[]; v_key text; v_text text; v_type text;
  v_child text; v_entry jsonb; v_number numeric; v_date date; v_ids text[];
begin
  case p_kind
    when 'review' then v_required:=array['id','asOf','currency','coverage','accounts','months','budget','opportunities','loans','notes','sources','createdAt','updatedAt']; v_allowed:=v_required;
    when 'coverage' then v_required:=array['from','to','completeThrough','transactionCount','accountCount','note']; v_allowed:=v_required;
    when 'account' then v_required:=array['id','label','ownership','balancePence','asOf']; v_allowed:=v_required;
    when 'month' then v_required:=array['month','incomePence','outflowPence','netPence','salaryPence','categories']; v_allowed:=v_required;
    when 'category' then v_required:=array['label','amountPence']; v_allowed:=v_required;
    when 'budget' then v_required:=array['incomePence','incomeBasis','essentials','workCostsPence','workCostsNote','scenarios']; v_allowed:=v_required;
    when 'essential' then v_required:=array['label','amountPence','note']; v_allowed:=v_required;
    when 'scenario' then v_required:=array['label','status','monthlyAdjustmentPence','note']; v_allowed:=v_required;
    when 'opportunity' then v_required:=array['label','monthlyPence','note']; v_allowed:=v_required||array['suggestedCapPence'];
    when 'loan' then
      v_required:=array['id','lender','purpose','status','balanceKind','rateNote','notes','sourceIds'];
      v_allowed:=v_required||array['monthlyPaymentPence','userSharePence','balancePence','balanceAsOf','startDate','endDate','aprPercent','settlementPence','settlementAsOf','nextPaymentDate','paymentsRemaining','originalPrincipalPence'];
    when 'source' then v_required:=array['id','label','url','asOf']; v_allowed:=v_required;
    else raise exception 'Unknown Finance object.' using errcode='22023';
  end case;
  if jsonb_typeof(p_value) is distinct from 'object' or not (p_value ?& v_required) then
    raise exception 'Finance % is missing required fields.',p_kind using errcode='22023';
  end if;
  for v_key in select jsonb_object_keys(p_value) loop
    if not (v_key=any(v_allowed)) then raise exception 'Unsupported Finance field: %.',v_key using errcode='22023'; end if;
    v_type:=jsonb_typeof(p_value->v_key); v_text:=p_value->>v_key;
    if v_key in ('coverage','budget') then
      perform helm_private.validate_finance_payload(p_value->v_key,v_key);
    elsif v_key in ('accounts','months','categories','essentials','scenarios','opportunities','loans','sources','sourceIds') or (p_kind='review' and v_key='notes') then
      if v_type is distinct from 'array' then raise exception 'Finance % must be an array.',v_key using errcode='22023'; end if;
      if jsonb_array_length(p_value->v_key) > (case when v_key='months' then 120 when v_key in ('accounts','loans','scenarios') then 50 else 100 end) then
        raise exception 'Finance % exceeds its entry limit.',v_key using errcode='22023';
      end if;
      for v_entry in select value from jsonb_array_elements(p_value->v_key) loop
        if v_key in ('notes','sourceIds') then
          if jsonb_typeof(v_entry) is distinct from 'string' or length(v_entry#>>'{}')>(case when v_key='sourceIds' then 256 else 4000 end)
            or (v_key='sourceIds' and (v_entry#>>'{}'='' or v_entry#>>'{}'<>btrim(v_entry#>>'{}'))) then
            raise exception 'Finance % entries must be bounded text.',v_key using errcode='22023';
          end if;
        else
          v_child:=case v_key when 'accounts' then 'account' when 'months' then 'month' when 'categories' then 'category' when 'essentials' then 'essential' when 'scenarios' then 'scenario' when 'opportunities' then 'opportunity' when 'loans' then 'loan' else 'source' end;
          perform helm_private.validate_finance_payload(v_entry,v_child);
        end if;
      end loop;
      if v_key in ('accounts','loans','sources') and exists(select 1 from jsonb_array_elements(p_value->v_key) entry group by entry->>'id' having count(*)>1) then
        raise exception 'Finance % contains duplicate IDs.',v_key using errcode='22023';
      end if;
      if v_key='months' and exists(select 1 from jsonb_array_elements(p_value->v_key) entry group by entry->>'month' having count(*)>1) then
        raise exception 'Finance months contains duplicates.' using errcode='22023';
      end if;
    elsif v_key like '%Pence' or v_key in ('transactionCount','accountCount','paymentsRemaining','aprPercent') then
      if v_type is distinct from 'number' then raise exception 'Finance % must be a bounded number.',v_key using errcode='22023'; end if;
      v_number:=v_text::numeric;
      if abs(v_number)>1000000000000 or (v_key<>'aprPercent' and trunc(v_number)<>v_number)
        or (v_number<0 and not (v_key in ('netPence','monthlyAdjustmentPence') or (v_key='balancePence' and p_kind='account') or (v_key='amountPence' and p_kind='category')))
        or (v_key='aprPercent' and v_number>1000) or (v_key in ('transactionCount','accountCount','paymentsRemaining') and v_number>10000000) then
        raise exception 'Finance % must be a bounded number.',v_key using errcode='22023';
      end if;
    else
      if v_type is distinct from 'string' or length(v_text)>(case when v_key='id' then 256 when v_key='url' then 2048 else 4000 end) then
        raise exception 'Finance % must be bounded text.',v_key using errcode='22023';
      end if;
      if v_key in ('id','label','lender') and (v_text='' or v_text<>btrim(v_text)) then raise exception 'Finance % requires trimmed nonempty text.',v_key using errcode='22023'; end if;
      if v_key='currency' and v_text<>'GBP' then raise exception 'Finance currency must be GBP.' using errcode='22023'; end if;
      if v_key='ownership' and v_text not in ('personal','household') then raise exception 'Finance ownership is invalid.' using errcode='22023'; end if;
      if v_key='status' and ((p_kind='loan' and v_text not in ('active','repaid','closed')) or (p_kind='scenario' and v_text not in ('planned','confirmed'))) then
        raise exception 'Finance status is invalid.' using errcode='22023';
      end if;
      if v_key='balanceKind' and v_text not in ('statement','settlement','estimate','unknown') then raise exception 'Finance balance kind is invalid.' using errcode='22023'; end if;
      if v_key='url' and (v_text !~ '^https?://[^[:space:]/?#]+[^[:space:]]*$' or v_text ~ '^https?://[^/?#]*@' or strpos(v_text,chr(92))>0) then
        raise exception 'Finance sources require HTTP or HTTPS URLs without credentials.' using errcode='22023';
      end if;
      if v_key in ('month','completeThrough') then
        if v_text !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or left(v_text,4)='0000' then raise exception 'Finance months must be YYYY-MM.' using errcode='22023'; end if;
      elsif v_key in ('asOf','from','to','balanceAsOf','startDate','endDate','settlementAsOf','nextPaymentDate') then
        if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(v_text,4)='0000' then raise exception 'Finance dates must be valid YYYY-MM-DD dates.' using errcode='22023'; end if;
        begin v_date:=v_text::date;
        exception when datetime_field_overflow or invalid_datetime_format then raise exception 'Finance dates must be valid YYYY-MM-DD dates.' using errcode='22023'; end;
        if to_char(v_date,'YYYY-MM-DD')<>v_text then raise exception 'Finance dates must be valid YYYY-MM-DD dates.' using errcode='22023'; end if;
      end if;
    end if;
  end loop;
  if p_kind='month' and (p_value->>'incomePence')::numeric-(p_value->>'outflowPence')::numeric<>(p_value->>'netPence')::numeric then
    raise exception 'Finance monthly net must equal income minus outflow.' using errcode='22023';
  end if;
  if p_kind='coverage' and ((p_value->>'from')>(p_value->>'to') or (p_value->>'completeThrough')>left(p_value->>'to',7)) then
    raise exception 'Finance coverage dates are inconsistent.' using errcode='22023';
  end if;
  if p_kind='loan' then
    if (p_value?'balancePence')<>(p_value?'balanceAsOf') or (p_value?'settlementPence')<>(p_value?'settlementAsOf') then
      raise exception 'Finance loan balances and settlements require their own dates.' using errcode='22023';
    end if;
    if p_value?'startDate' and p_value?'endDate' and (p_value->>'startDate')>(p_value->>'endDate') then raise exception 'Finance loan end precedes its start.' using errcode='22023'; end if;
  end if;
  if p_kind='review' then
    if p_value->>'id'<>'current' then raise exception 'Finance review id must be current.' using errcode='22023'; end if;
    select coalesce(array_agg(entry->>'id'),array[]::text[]) into v_ids from jsonb_array_elements(p_value->'sources') entry;
    if exists(select 1 from jsonb_array_elements(p_value->'loans') loan, jsonb_array_elements_text(loan->'sourceIds') source_id where not (source_id=any(v_ids))) then
      raise exception 'Finance loans reference an unknown source.' using errcode='22023';
    end if;
  end if;
end;
$$;

create function public.finance_get_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user_id uuid; v_review jsonb;
begin
  v_user_id:=helm_private.require_finance_actor();
  select payload into v_review from public.helm_records where user_id=v_user_id and collection='financeReviews' and record_id='current' and deleted_at is null;
  return v_review;
end;
$$;

create function public.finance_save_review(p_request_id uuid,p_review jsonb,p_expected_updated_at text)
returns jsonb language plpgsql security definer set search_path = ''
set statement_timeout='10s' set lock_timeout='3s' as $$
declare
  v_user_id uuid; v_fingerprint text; v_existing_fingerprint text; v_claimed boolean; v_result jsonb;
  v_record public.helm_records%rowtype; v_review jsonb; v_version bigint; v_now timestamptz;
begin
  v_user_id:=helm_private.require_finance_actor();
  if p_request_id is null or jsonb_typeof(p_review) is distinct from 'object' or octet_length(p_review::text)>262144
    or (p_expected_updated_at is not null and length(p_expected_updated_at) not between 1 and 64) then
    raise exception 'Finance save requires bounded input and an idempotency key.' using errcode='22023';
  end if;
  if p_review ?| array['id','createdAt','updatedAt'] then raise exception 'Finance identity and timestamps are assigned by the server.' using errcode='22023'; end if;
  v_fingerprint:=encode(extensions.digest(jsonb_build_object('clientId',auth.jwt()->>'client_id','review',p_review,'expectedUpdatedAt',p_expected_updated_at)::text,'sha256'),'hex');
  insert into public.helm_finance_mutation_receipts(user_id,request_id,request_fingerprint) values(v_user_id,p_request_id,v_fingerprint)
    on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed,false) then
    select request_fingerprint,result into v_existing_fingerprint,v_result from public.helm_finance_mutation_receipts where user_id=v_user_id and request_id=p_request_id;
    if v_fingerprint is distinct from v_existing_fingerprint then raise exception 'Finance idempotency key was reused with different arguments or client.' using errcode='22023'; end if;
    if v_result is null then raise exception 'Finance save is still being committed.' using errcode='40001'; end if;
    return v_result;
  end if;
  insert into public.helm_account_state(user_id) values(v_user_id) on conflict do nothing;
  select account_version into v_version from public.helm_account_state where user_id=v_user_id for update;
  select * into v_record from public.helm_records where user_id=v_user_id and collection='financeReviews' and record_id='current' for update;
  if p_expected_updated_at is distinct from (case when v_record.deleted_at is null then v_record.payload->>'updatedAt' else null end) then
    raise exception 'Finance review changed; reload before saving.' using errcode='40001';
  end if;
  v_now:=clock_timestamp();
  v_review:=p_review || jsonb_build_object('id','current','createdAt',coalesce(v_record.payload->'createdAt',to_jsonb(v_now)),'updatedAt',v_now);
  perform helm_private.validate_finance_payload(v_review);
  v_version:=v_version+1;
  insert into public.helm_records(user_id,collection,record_id,payload,revision,account_version,updated_at,deleted_at)
    values(v_user_id,'financeReviews','current',v_review,1,v_version,v_now,null)
    on conflict(user_id,collection,record_id) do update set payload=excluded.payload,revision=helm_records.revision+1,account_version=v_version,updated_at=v_now,deleted_at=null
    returning * into v_record;
  update public.helm_account_state set account_version=v_version,updated_at=v_now where user_id=v_user_id;
  perform realtime.send(jsonb_build_object('requestId',p_request_id,'accountVersion',v_version,'changes',jsonb_build_array(jsonb_build_object('collection','financeReviews','recordId','current','revision',v_record.revision,'deletedAt',null))),
    'helm_records_changed','helm:account:' || v_user_id::text,true);
  v_result:=jsonb_build_object('review',v_review,'accountVersion',v_version);
  update public.helm_finance_mutation_receipts set result=v_result,applied_at=v_now where user_id=v_user_id and request_id=p_request_id;
  return v_result;
end;
$$;
create function public.list_finance_oauth_clients()
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
  into v_clients from public.helm_finance_oauth_clients where user_id = v_user_id;
  return v_clients;
end;
$$;

create function public.approve_finance_oauth_client(p_client_id text, p_client_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_client public.helm_finance_oauth_clients%rowtype;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  if p_client_id is null or p_client_id <> btrim(p_client_id) or length(p_client_id) not between 1 and 512
    or p_client_name is null or p_client_name <> btrim(p_client_name) or length(p_client_name) not between 1 and 160 then
    raise exception 'OAuth client identity is invalid.' using errcode = '22023';
  end if;
  insert into public.helm_finance_oauth_clients (
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

create function public.revoke_finance_oauth_client(p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid; v_client public.helm_finance_oauth_clients%rowtype;
begin
  v_user_id := helm_private.assert_direct_sabah_one_session();
  if p_client_id is null or p_client_id <> btrim(p_client_id)
    or length(p_client_id) not between 1 and 512 then
    raise exception 'OAuth client identity is invalid.' using errcode = '22023';
  end if;
  update public.helm_finance_oauth_clients set revoked_at = now(), updated_at = now()
  where user_id = v_user_id and client_id = p_client_id
  returning * into v_client;
  if not found then raise exception 'Approved OAuth client was not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'clientId', v_client.client_id, 'clientName', v_client.client_name,
    'approvedAt', v_client.approved_at, 'revokedAt', v_client.revoked_at
  );
end;
$$;



revoke execute on function helm_private.require_finance_actor() from public, anon, authenticated;
revoke execute on function helm_private.validate_finance_payload(jsonb,text) from public, anon, authenticated;
revoke all on function public.finance_get_review() from public, anon;
grant execute on function public.finance_get_review() to authenticated;
revoke all on function public.finance_save_review(uuid,jsonb,text) from public, anon;
grant execute on function public.finance_save_review(uuid,jsonb,text) to authenticated;
revoke all on function public.list_finance_oauth_clients() from public, anon;
grant execute on function public.list_finance_oauth_clients() to authenticated;
revoke all on function public.approve_finance_oauth_client(text,text) from public, anon;
grant execute on function public.approve_finance_oauth_client(text,text) to authenticated;
revoke all on function public.revoke_finance_oauth_client(text) from public, anon;
grant execute on function public.revoke_finance_oauth_client(text) to authenticated;

commit;
