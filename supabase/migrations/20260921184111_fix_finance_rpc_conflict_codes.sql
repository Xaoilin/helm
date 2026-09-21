begin;

-- PostgREST 14 retries SQLSTATE 40001 RPC failures indefinitely. Return an
-- explicit HTTP conflict for idempotency and optimistic-revision conflicts.
create or replace function public.finance_save_review(p_request_id uuid,p_review jsonb,p_expected_updated_at text)
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
    if v_result is null then raise sqlstate 'PT409' using message='Finance save is still being committed.'; end if;
    return v_result;
  end if;
  insert into public.helm_account_state(user_id) values(v_user_id) on conflict do nothing;
  select account_version into v_version from public.helm_account_state where user_id=v_user_id for update;
  select * into v_record from public.helm_records where user_id=v_user_id and collection='financeReviews' and record_id='current' for update;
  if p_expected_updated_at is distinct from (case when v_record.deleted_at is null then v_record.payload->>'updatedAt' else null end) then
    raise sqlstate 'PT409' using message='Finance review changed; reload before saving.';
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

commit;
