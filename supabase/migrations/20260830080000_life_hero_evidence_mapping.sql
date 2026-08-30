begin;

-- KAN-262 keeps source mapping in the database boundary. The source record is
-- authoritative; the Life Hero tables remain an append-only derived ledger.
create or replace function helm_private.accept_life_hero_evidence_for_user(
  p_user_id uuid,
  p_idempotency_key text,
  p_evidence_type text,
  p_source_tier text,
  p_source_reference text,
  p_occurred_at timestamptz,
  p_local_date date,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '3s'
as $$
declare
  v_ruleset_version text;
  v_stat text;
  v_base_xp integer;
  v_source_multiplier numeric(6,3);
  v_previous_local_date date;
  v_previous_momentum_days integer;
  v_momentum_days integer := 1;
  v_momentum_multiplier numeric(6,3);
  v_awarded_xp integer;
  v_evidence_id uuid := extensions.gen_random_uuid();
  v_existing public.life_hero_evidence%rowtype;
  v_metadata_entry record;
begin
  if p_user_id is null then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  p_idempotency_key := btrim(coalesce(p_idempotency_key, ''));
  p_evidence_type := btrim(coalesce(p_evidence_type, ''));
  p_source_tier := btrim(coalesce(p_source_tier, ''));
  p_source_reference := btrim(coalesce(p_source_reference, ''));
  if p_idempotency_key = '' or length(p_idempotency_key) > 256 then
    raise exception 'Life Hero evidence needs a bounded idempotency key.' using errcode = '22023';
  end if;
  if p_source_reference = '' or length(p_source_reference) > 512 then
    raise exception 'Life Hero evidence needs a bounded source reference.' using errcode = '22023';
  end if;
  if p_occurred_at is null or p_local_date is null then
    raise exception 'Life Hero evidence needs occurrence and local dates.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_metadata) <> 'object' or octet_length(p_metadata::text) > 8192 then
    raise exception 'Life Hero evidence metadata must be a small object.' using errcode = '22023';
  end if;
  for v_metadata_entry in select key, value from jsonb_each(p_metadata) loop
    if v_metadata_entry.key ~* '(authorization|cookie|credential|password|raw|secret|token)'
      or jsonb_typeof(v_metadata_entry.value) not in ('string', 'number', 'boolean', 'null')
    then
      raise exception 'Life Hero evidence metadata must be flat and exclude sensitive fields.'
        using errcode = '22023';
    end if;
  end loop;

  perform helm_private.initialize_life_hero_profile(p_user_id);
  select ruleset_version into v_ruleset_version
  from public.life_hero_profiles
  where user_id = p_user_id
  for update;

  select evidence_rule.stat, evidence_rule.base_xp, source_rule.xp_multiplier
  into v_stat, v_base_xp, v_source_multiplier
  from public.life_hero_evidence_rules as evidence_rule
  join public.life_hero_source_tier_rules as source_rule
    on source_rule.ruleset_version = evidence_rule.ruleset_version
   and source_rule.source_tier = p_source_tier
  where evidence_rule.ruleset_version = v_ruleset_version
    and evidence_rule.evidence_type = p_evidence_type;
  if not found then
    raise exception 'This evidence type or source tier cannot award Life Hero XP.'
      using errcode = '22023';
  end if;

  select * into v_existing
  from public.life_hero_evidence
  where user_id = p_user_id
    and (
      idempotency_key = p_idempotency_key
      or (
        ruleset_version = v_ruleset_version
        and evidence_type = p_evidence_type
        and source_tier = p_source_tier
        and source_reference = p_source_reference
      )
    )
  order by (idempotency_key = p_idempotency_key) desc
  limit 1;

  if found then
    if v_existing.idempotency_key = p_idempotency_key and (
      v_existing.evidence_type <> p_evidence_type
      or v_existing.source_tier <> p_source_tier
      or v_existing.source_reference <> p_source_reference
      or v_existing.occurred_at <> p_occurred_at
      or v_existing.local_date <> p_local_date
    ) then
      raise exception 'The Life Hero idempotency key was already used for different evidence.'
        using errcode = '23505';
    end if;
    return jsonb_build_object('duplicate', true, 'evidenceId', v_existing.id);
  end if;

  select evidence.local_date, award.momentum_days
  into v_previous_local_date, v_previous_momentum_days
  from public.life_hero_awards as award
  join public.life_hero_evidence as evidence on evidence.id = award.evidence_id
  where award.user_id = p_user_id
    and award.stat = v_stat
    and evidence.local_date <= p_local_date
  order by evidence.local_date desc, evidence.occurred_at desc, award.awarded_at desc
  limit 1;

  if found then
    if v_previous_local_date = p_local_date then
      v_momentum_days := v_previous_momentum_days;
    elsif v_previous_local_date = p_local_date - 1 then
      v_momentum_days := v_previous_momentum_days + 1;
    end if;
  end if;

  select xp_multiplier into v_momentum_multiplier
  from public.life_hero_momentum_rules
  where ruleset_version = v_ruleset_version
    and minimum_days <= v_momentum_days
  order by minimum_days desc
  limit 1;
  if v_momentum_multiplier is null then
    raise exception 'The Life Hero momentum ruleset is incomplete.' using errcode = '55000';
  end if;

  v_awarded_xp := greatest(1, round(
    v_base_xp::numeric * v_source_multiplier * v_momentum_multiplier
  )::integer);

  insert into public.life_hero_evidence (
    id, user_id, ruleset_version, stat, evidence_type, source_tier,
    source_reference, idempotency_key, occurred_at, local_date, metadata
  ) values (
    v_evidence_id, p_user_id, v_ruleset_version, v_stat, p_evidence_type, p_source_tier,
    p_source_reference, p_idempotency_key, p_occurred_at, p_local_date, p_metadata
  );

  insert into public.life_hero_awards (
    user_id, evidence_id, ruleset_version, stat, base_xp, source_multiplier,
    momentum_days, momentum_multiplier, awarded_xp, momentum_snapshot
  ) values (
    p_user_id, v_evidence_id, v_ruleset_version, v_stat, v_base_xp, v_source_multiplier,
    v_momentum_days, v_momentum_multiplier, v_awarded_xp,
    jsonb_build_object(
      'rulesetVersion', v_ruleset_version,
      'previousLocalDate', v_previous_local_date,
      'momentumDays', v_momentum_days,
      'multiplier', v_momentum_multiplier
    )
  );

  perform helm_private.recompute_life_hero_profile(p_user_id);
  return jsonb_build_object('duplicate', false, 'evidenceId', v_evidence_id);
end;
$$;

revoke all on function helm_private.accept_life_hero_evidence_for_user(
  uuid, text, text, text, text, timestamptz, date, jsonb
) from public, anon, authenticated;

-- Keep the existing public contract and receipt shape while routing both direct
-- submissions and source synchronization through one idempotent implementation.
create or replace function public.accept_life_hero_evidence(
  p_idempotency_key text,
  p_evidence_type text,
  p_source_tier text,
  p_source_reference text,
  p_occurred_at timestamptz,
  p_local_date date,
  p_metadata jsonb default '{}'::jsonb
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
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'Anonymous sessions cannot award Life Hero progress.' using errcode = '42501';
  end if;
  v_result := helm_private.accept_life_hero_evidence_for_user(
    v_user_id, p_idempotency_key, p_evidence_type, p_source_tier,
    p_source_reference, p_occurred_at, p_local_date, p_metadata
  );
  return helm_private.life_hero_evidence_receipt(
    (v_result ->> 'evidenceId')::uuid,
    (v_result ->> 'duplicate')::boolean,
    p_local_date
  );
end;
$$;

revoke all on function public.accept_life_hero_evidence(
  text, text, text, text, timestamptz, date, jsonb
) from public, anon;
grant execute on function public.accept_life_hero_evidence(
  text, text, text, text, timestamptz, date, jsonb
) to authenticated;

create or replace function helm_private.life_hero_safe_date(p_value text)
returns date
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p_value::date;
exception when others then return null;
end;
$$;

create or replace function helm_private.life_hero_safe_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then return null; end if;
  return p_value::timestamptz;
exception when others then return null;
end;
$$;

revoke all on function helm_private.life_hero_safe_date(text) from public, anon, authenticated;
revoke all on function helm_private.life_hero_safe_timestamptz(text) from public, anon, authenticated;

create or replace function helm_private.record_life_hero_source_evidence(
  p_user_id uuid,
  p_evidence_type text,
  p_source_tier text,
  p_source_reference text,
  p_occurred_at timestamptz,
  p_local_date date,
  p_source_collection text,
  p_source_record_id text,
  p_source_revision bigint,
  p_source_updated_at timestamptz,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := helm_private.accept_life_hero_evidence_for_user(
    p_user_id,
    format(
      'life-hero-sync:%s',
      encode(extensions.digest(convert_to(p_source_reference, 'UTF8'), 'sha256'), 'hex')
    ),
    p_evidence_type, p_source_tier,
    p_source_reference, p_occurred_at, p_local_date,
    jsonb_build_object(
      'mappingVersion', 'life-hero-source-mapping-v1',
      'sourceCollection', p_source_collection,
      'sourceRecordId', p_source_record_id,
      'sourceRevision', p_source_revision,
      'sourceUpdatedAt', p_source_updated_at,
      'reason', p_reason
    )
  );
  return (v_result ->> 'duplicate')::boolean;
end;
$$;

revoke all on function helm_private.record_life_hero_source_evidence(
  uuid, text, text, text, timestamptz, date, text, text, bigint, timestamptz, text
) from public, anon, authenticated;

create or replace function helm_private.sync_life_hero_evidence(
  p_user_id uuid,
  p_as_of_local_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '3s'
as $$
declare
  v_record public.helm_records%rowtype;
  v_profile public.helm_records%rowtype;
  v_log record;
  v_pillar record;
  v_local_date date;
  v_occurred_at timestamptz;
  v_created_at timestamptz;
  v_previous_amount numeric;
  v_amount numeric;
  v_monzo_tag text;
  v_reason text;
  v_source_reference text;
  v_duplicate boolean;
  v_new_count integer := 0;
  v_duplicate_count integer := 0;
  v_skipped_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if p_as_of_local_date is null then
    raise exception 'A Life Hero local date is required.' using errcode = '22023';
  end if;

  perform helm_private.initialize_life_hero_profile(p_user_id);

  -- Canonical prayer records are the only source of Faith evidence. Missed,
  -- unclassified, reminder, and activation records never award progress.
  for v_record in
    select * from public.helm_records
    where user_id = p_user_id and collection = 'prayerTracking' and record_id like 'record:%'
      and deleted_at is null
    order by record_id
  loop
    v_local_date := helm_private.life_hero_safe_date(v_record.payload ->> 'date');
    v_occurred_at := coalesce(helm_private.life_hero_safe_timestamptz(v_record.payload ->> 'recordedAt'), v_record.updated_at);
    if v_local_date is null
      or coalesce(v_record.payload ->> 'prayerName', '') = ''
      or coalesce(v_record.payload ->> 'status', '') not in ('on_time', 'late')
    then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;
    v_source_reference := format('life-hero:prayerTracking:%s', v_record.record_id);
    v_reason := format('Prayer %s was recorded as %s on %s.', v_record.payload ->> 'prayerName', v_record.payload ->> 'status', v_local_date);
    v_duplicate := helm_private.record_life_hero_source_evidence(
      p_user_id, 'faith_practice', 'verified', v_source_reference, v_occurred_at,
      v_local_date, v_record.collection, v_record.record_id, v_record.revision,
      v_record.updated_at, v_reason
    );
    if v_duplicate then v_duplicate_count := v_duplicate_count + 1; else v_new_count := v_new_count + 1; end if;
  end loop;

  -- Learn and Move progress is stored inside the database-authoritative
  -- gamification profile. A positive local-date log is one evidence event.
  select * into v_profile
  from public.helm_records
  where user_id = p_user_id and collection = 'gamification' and record_id = 'profile' and deleted_at is null;
  if found then
    for v_pillar in
      select * from (values
        ('dailyMomentumLearn', 'knowledge_learning', 'Learn'),
        ('dailyMomentumMove', 'vitality_activity', 'Move')
      ) as pillars(field_name, evidence_type, label)
    loop
      for v_log in
        select * from jsonb_each(
          case when jsonb_typeof(v_profile.payload -> v_pillar.field_name -> 'logs') = 'object'
            then v_profile.payload -> v_pillar.field_name -> 'logs' else '{}'::jsonb end
        )
      loop
        v_local_date := helm_private.life_hero_safe_date(v_log.value ->> 'date');
        v_occurred_at := coalesce(helm_private.life_hero_safe_timestamptz(v_log.value ->> 'updatedAt'), v_profile.updated_at);
        if v_local_date is null
          or (v_log.value ->> 'pillar') <> (case when v_pillar.label = 'Learn' then 'learn' else 'move' end)
          or jsonb_typeof(v_log.value -> 'progress') <> 'object'
          or not exists (
            select 1 from jsonb_each(v_log.value -> 'progress') as progress(step_id, amount)
            where jsonb_typeof(progress.amount) = 'number' and (progress.amount #>> '{}')::numeric > 0
          )
        then
          v_skipped_count := v_skipped_count + 1;
          continue;
        end if;
        v_source_reference := format('life-hero:gamification:profile:%s:%s', v_pillar.field_name, v_log.key);
        v_reason := format('%s progress was recorded on %s.', v_pillar.label, v_local_date);
        v_duplicate := helm_private.record_life_hero_source_evidence(
          p_user_id, v_pillar.evidence_type, 'self_reported', v_source_reference, v_occurred_at,
          v_local_date, 'gamification', 'profile', v_profile.revision, v_profile.updated_at, v_reason
        );
        if v_duplicate then v_duplicate_count := v_duplicate_count + 1; else v_new_count := v_new_count + 1; end if;
      end loop;
    end loop;
  end if;

  -- Completed non-prayer tasks are Discipline evidence. Prayer tasks are
  -- excluded because prayerTracking is the canonical Faith source.
  for v_record in
    select * from public.helm_records
    where user_id = p_user_id and collection = 'tasks' and deleted_at is null
    order by record_id
  loop
    if v_record.payload ->> 'completed' <> 'true'
      or v_record.payload ->> 'category' = 'prayer'
      or v_record.payload ? 'prayerName'
    then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;
    v_occurred_at := coalesce(helm_private.life_hero_safe_timestamptz(v_record.payload ->> 'completedAt'), v_record.updated_at);
    v_local_date := v_occurred_at::date;
    v_source_reference := format('life-hero:tasks:%s', v_record.record_id);
    v_reason := format('Completed Sabah One %s task %s on %s.', coalesce(nullif(v_record.payload ->> 'category', ''), 'task'), v_record.record_id, v_local_date);
    v_duplicate := helm_private.record_life_hero_source_evidence(
      p_user_id, 'discipline_commitment', 'self_reported', v_source_reference, v_occurred_at,
      v_local_date, v_record.collection, v_record.record_id, v_record.revision, v_record.updated_at, v_reason
    );
    if v_duplicate then v_duplicate_count := v_duplicate_count + 1; else v_new_count := v_new_count + 1; end if;
  end loop;

  -- Budgets and savings goals reward financial practice, not balances or
  -- wealth. Goal identity is stable; its first positive state is the event.
  for v_record in
    select * from public.helm_records
    where user_id = p_user_id and collection = 'financeBudgets' and deleted_at is null
    order by record_id
  loop
    if jsonb_typeof(v_record.payload -> 'monthlyLimit') <> 'number'
      or (v_record.payload ->> 'monthlyLimit')::numeric <= 0
    then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;
    v_occurred_at := coalesce(helm_private.life_hero_safe_timestamptz(v_record.payload ->> 'createdAt'), v_record.updated_at);
    v_local_date := v_occurred_at::date;
    v_source_reference := format('life-hero:financeBudgets:%s', v_record.record_id);
    v_reason := format('Budget %s was configured with a positive limit.', v_record.record_id);
    v_duplicate := helm_private.record_life_hero_source_evidence(
      p_user_id, 'financial_progress', 'self_reported', v_source_reference, v_occurred_at,
      v_local_date, v_record.collection, v_record.record_id, v_record.revision, v_record.updated_at, v_reason
    );
    if v_duplicate then v_duplicate_count := v_duplicate_count + 1; else v_new_count := v_new_count + 1; end if;
  end loop;

  for v_record in
    select * from public.helm_records
    where user_id = p_user_id and collection = 'savingsGoals' and deleted_at is null
    order by record_id
  loop
    if not (
      (jsonb_typeof(v_record.payload -> 'currentAmount') = 'number' and (v_record.payload ->> 'currentAmount')::numeric > 0)
      or v_record.payload ->> 'completed' = 'true'
    ) then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;
    v_occurred_at := coalesce(helm_private.life_hero_safe_timestamptz(v_record.payload ->> 'updatedAt'), v_record.updated_at);
    v_local_date := v_occurred_at::date;
    v_source_reference := format('life-hero:savingsGoals:%s:%s', v_record.record_id,
      case when v_record.payload ->> 'completed' = 'true' then 'completed' else v_record.payload ->> 'currentAmount' end);
    v_reason := format('Savings goal %s recorded positive progress.', v_record.record_id);
    v_duplicate := helm_private.record_life_hero_source_evidence(
      p_user_id, 'financial_progress', 'self_reported', v_source_reference, v_occurred_at,
      v_local_date, v_record.collection, v_record.record_id, v_record.revision, v_record.updated_at, v_reason
    );
    if v_duplicate then v_duplicate_count := v_duplicate_count + 1; else v_new_count := v_new_count + 1; end if;
  end loop;

  -- Transactions only reward a saving transfer or a demonstrable reduction in
  -- avoidable spend. Income, account balances, ordinary expenses, and wealth
  -- growth are intentionally not evidence.
  for v_record in
    select * from public.helm_records
    where user_id = p_user_id and collection = 'transactions' and deleted_at is null
    order by record_id
  loop
    if jsonb_typeof(v_record.payload -> 'amount') <> 'number'
      or (v_record.payload ->> 'amount')::numeric <= 0
      or v_record.payload ->> 'date' is null
    then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;
    v_amount := (v_record.payload ->> 'amount')::numeric;
    v_local_date := helm_private.life_hero_safe_date(v_record.payload ->> 'date');
    if v_local_date is null then v_skipped_count := v_skipped_count + 1; continue; end if;
    v_created_at := coalesce(helm_private.life_hero_safe_timestamptz(v_record.payload ->> 'createdAt'), v_record.updated_at);
    v_monzo_tag := null;
    select tag into v_monzo_tag
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_record.payload -> 'tags') = 'array' then v_record.payload -> 'tags' else '[]'::jsonb end
    ) as tags(tag)
    where tag like 'monzo:%' order by tag limit 1;

    if v_record.payload ->> 'type' = 'transfer'
      and exists (
        select 1 from public.helm_records as destination
        where destination.user_id = p_user_id and destination.collection = 'financeAccounts'
          and destination.record_id = v_record.payload ->> 'toAccountId'
          and destination.deleted_at is null and destination.payload ->> 'type' = 'savings'
      )
    then
      v_source_reference := case when v_monzo_tag is not null
        then format('life-hero:monzo:%s', substring(v_monzo_tag from 7))
        else format('life-hero:transactions:%s:saving', v_record.record_id) end;
      v_reason := format('Transfer %s recorded money into a savings account.', v_record.record_id);
    elsif v_record.payload ->> 'type' = 'expense'
      and v_record.payload ->> 'category' in ('eating-out', 'subscriptions', 'entertainment')
      and (
        exists (
          select 1 from jsonb_array_elements_text(
            case when jsonb_typeof(v_record.payload -> 'tags') = 'array' then v_record.payload -> 'tags' else '[]'::jsonb end
          ) as tags(tag) where tag = 'avoidable-improvement'
        )
        or exists (
          select 1 from public.helm_records as prior
          where prior.user_id = p_user_id and prior.collection = 'transactions' and prior.deleted_at is null
            and prior.record_id <> v_record.record_id and prior.payload ->> 'type' = 'expense'
            and prior.payload ->> 'category' = v_record.payload ->> 'category'
            and helm_private.life_hero_safe_date(prior.payload ->> 'date') < v_local_date
            and jsonb_typeof(prior.payload -> 'amount') = 'number'
            and (prior.payload ->> 'amount')::numeric > v_amount
        )
      )
    then
      select min((prior.payload ->> 'amount')::numeric) into v_previous_amount
      from public.helm_records as prior
      where prior.user_id = p_user_id and prior.collection = 'transactions' and prior.deleted_at is null
        and prior.record_id <> v_record.record_id and prior.payload ->> 'type' = 'expense'
        and prior.payload ->> 'category' = v_record.payload ->> 'category'
        and helm_private.life_hero_safe_date(prior.payload ->> 'date') < v_local_date
        and jsonb_typeof(prior.payload -> 'amount') = 'number';
      v_source_reference := case when v_monzo_tag is not null
        then format('life-hero:monzo:%s', substring(v_monzo_tag from 7))
        else format('life-hero:transactions:%s:avoidable-improvement', v_record.record_id) end;
      v_reason := case when v_previous_amount is not null then format('Avoidable %s spending improved from %s to %s pence.', v_record.payload ->> 'category', v_previous_amount, v_amount)
        else format('Avoidable %s spending improvement was explicitly recorded.', v_record.payload ->> 'category') end;
    else
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    v_duplicate := helm_private.record_life_hero_source_evidence(
      p_user_id, 'financial_progress', case when v_monzo_tag is not null then 'trusted_integration' else 'self_reported' end,
      v_source_reference, v_created_at, v_local_date, v_record.collection, v_record.record_id,
      v_record.revision, v_record.updated_at, v_reason
    );
    if v_duplicate then v_duplicate_count := v_duplicate_count + 1; else v_new_count := v_new_count + 1; end if;
  end loop;

  return jsonb_build_object(
    'mappingVersion', 'life-hero-source-mapping-v1', 'asOfLocalDate', p_as_of_local_date,
    'newEvidence', v_new_count, 'duplicates', v_duplicate_count, 'skipped', v_skipped_count
  );
end;
$$;

revoke all on function helm_private.sync_life_hero_evidence(uuid, date) from public, anon, authenticated;

create or replace function public.sync_life_hero_evidence(p_as_of_local_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '3s'
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'Anonymous users cannot synchronize Life Hero evidence.' using errcode = '42501';
  end if;
  return helm_private.sync_life_hero_evidence(v_user_id, p_as_of_local_date);
end;
$$;

revoke all on function public.sync_life_hero_evidence(date) from public, anon;
grant execute on function public.sync_life_hero_evidence(date) to authenticated;

-- Backfill only authenticated, database-owned records. It never reads an
-- external provider and never converts legacy gamification totals into XP.
do $backfill_life_hero_source_evidence$
declare
  v_user_id uuid;
begin
  for v_user_id in select id from auth.users loop
    perform helm_private.sync_life_hero_evidence(v_user_id, current_date);
  end loop;
end;
$backfill_life_hero_source_evidence$;

comment on function public.sync_life_hero_evidence(date) is
  'Synchronizes positive database-authoritative Sabah One life records into the idempotent Life Hero evidence ledger.';
comment on function helm_private.sync_life_hero_evidence(uuid, date) is
  'KAN-262 source mapping: Prayer, Learn, Move, tasks, budgeting, savings, and bounded financial-practice evidence only.';

commit;
