begin;

create or replace function helm_private.life_hero_try_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::date;
exception when others then
  return null;
end;
$$;

create or replace function helm_private.life_hero_try_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function helm_private.life_hero_local_date_in_zone(
  p_value timestamptz,
  p_time_zone text
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or nullif(p_time_zone, '') is null then
    return null;
  end if;
  return timezone(p_time_zone, p_value)::date;
exception when others then
  return null;
end;
$$;

create or replace function helm_private.life_hero_daily_momentum_level(p_log jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_level jsonb;
  v_step jsonb;
  v_complete boolean;
  v_achieved integer := 0;
begin
  if jsonb_typeof(p_log) <> 'object'
    or jsonb_typeof(p_log -> 'progress') <> 'object'
    or jsonb_typeof(p_log #> '{template,levels}') <> 'array'
  then
    return 0;
  end if;

  for v_level in
    select value from jsonb_array_elements(p_log #> '{template,levels}')
  loop
    if jsonb_typeof(v_level) <> 'object'
      or (v_level ->> 'level') !~ '^[1-5]$'
      or jsonb_typeof(v_level -> 'steps') <> 'array'
    then
      continue;
    end if;
    v_complete := true;
    for v_step in select value from jsonb_array_elements(v_level -> 'steps') loop
      if jsonb_typeof(v_step) <> 'object'
        or coalesce(v_step ->> 'id', '') = ''
        or jsonb_typeof(v_step -> 'amount') <> 'number'
        or jsonb_typeof((p_log -> 'progress') -> (v_step ->> 'id')) <> 'number'
        or (((p_log -> 'progress') ->> (v_step ->> 'id'))::numeric
          < (v_step ->> 'amount')::numeric)
      then
        v_complete := false;
        exit;
      end if;
    end loop;
    if v_complete then
      v_achieved := greatest(v_achieved, (v_level ->> 'level')::integer);
    end if;
  end loop;
  return v_achieved;
end;
$$;

revoke all on function helm_private.life_hero_try_date(text) from public, anon, authenticated;
revoke all on function helm_private.life_hero_try_timestamptz(text) from public, anon, authenticated;
revoke all on function helm_private.life_hero_local_date_in_zone(timestamptz, text)
from public, anon, authenticated;
revoke all on function helm_private.life_hero_daily_momentum_level(jsonb) from public, anon, authenticated;

create or replace function public.sync_life_hero_evidence(
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
  v_user_id uuid := (select auth.uid());
  v_candidate record;
  v_receipt jsonb;
  v_scanned integer := 0;
  v_accepted integer := 0;
  v_duplicates integer := 0;
begin
  if v_user_id is null then
    raise exception 'A signed-in Sabah One account is required.' using errcode = '42501';
  end if;
  if coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) then
    raise exception 'Anonymous sessions cannot sync Life Hero progress.' using errcode = '42501';
  end if;
  if p_as_of_local_date is null then
    raise exception 'Life Hero sync needs a local date.' using errcode = '22023';
  end if;

  for v_candidate in
    with owner_records as (
      select record.collection, record.record_id, record.payload,
        record.created_at, record.updated_at
      from public.helm_records as record
      where record.user_id = v_user_id and record.deleted_at is null
    ),
    account_context as (
      select coalesce(
        nullif((
          select settings.payload ->> 'appTimezone'
          from owner_records as settings
          where settings.collection = 'settings' and settings.record_id = 'singleton'
          limit 1
        ), ''),
        'UTC'
      ) as time_zone
    ),
    task_completions as (
      select
        task.record_id,
        task.payload,
        parsed.completed_at,
        coalesce(
          explicit.local_date,
          helm_private.life_hero_local_date_in_zone(
            parsed.completed_at,
            nullif(task.payload ->> 'completionTimeZone', '')
          ),
          helm_private.life_hero_local_date_in_zone(
            parsed.completed_at,
            account.time_zone
          ),
          parsed.completed_at::date
        ) as local_date,
        case
          when explicit.local_date is not null then 'explicit'
          when helm_private.life_hero_local_date_in_zone(
            parsed.completed_at,
            nullif(task.payload ->> 'completionTimeZone', '')
          ) is not null then 'completion_timezone_fallback'
          when helm_private.life_hero_local_date_in_zone(
            parsed.completed_at,
            account.time_zone
          ) is not null then 'account_timezone_fallback'
          else 'utc_fallback'
        end as local_date_source,
        case
          when explicit.local_date is not null then
            nullif(task.payload ->> 'completionTimeZone', '')
          when helm_private.life_hero_local_date_in_zone(
            parsed.completed_at,
            nullif(task.payload ->> 'completionTimeZone', '')
          ) is not null then nullif(task.payload ->> 'completionTimeZone', '')
          when helm_private.life_hero_local_date_in_zone(
            parsed.completed_at,
            account.time_zone
          ) is not null then account.time_zone
          else 'UTC'
        end as time_zone
      from owner_records as task
      cross join account_context as account
      cross join lateral (
        select helm_private.life_hero_try_timestamptz(
          task.payload ->> 'completedAt'
        ) as completed_at
      ) as parsed
      cross join lateral (
        select helm_private.life_hero_try_date(
          task.payload ->> 'completedLocalDate'
        ) as local_date
      ) as explicit
      where task.collection = 'tasks'
        and task.payload ->> 'completed' = 'true'
        and coalesce(task.payload ->> 'category', 'task') <> 'prayer'
        and parsed.completed_at is not null
    ),
    momentum_logs as (
      select
        profile_key.key as profile_field,
        log.key as log_key,
        log.value as payload
      from owner_records as profile
      cross join lateral (values
        ('dailyMomentumLearn'), ('dailyMomentumMove')
      ) as profile_key(key)
      cross join lateral jsonb_each(
        case
          when jsonb_typeof(profile.payload -> profile_key.key -> 'logs') = 'object'
            then profile.payload -> profile_key.key -> 'logs'
          else '{}'::jsonb
        end
      ) as log(key, value)
      where profile.collection = 'gamification' and profile.record_id = 'profile'
    ),
    finance_months as (
      select
        date_trunc('month', transaction_date)::date as month_start,
        sum(amount) filter (where category = any(array[
          'eating-out', 'subscriptions', 'entertainment', 'clothing', 'personal-care'
        ])) as avoidable_spend,
        count(*) filter (where category = any(array[
          'eating-out', 'subscriptions', 'entertainment', 'clothing', 'personal-care'
        ])) as avoidable_count,
        bool_or(is_monzo) as includes_monzo
      from (
        select
          helm_private.life_hero_try_date(record.payload ->> 'date') as transaction_date,
          record.payload ->> 'category' as category,
          case when jsonb_typeof(record.payload -> 'amount') = 'number'
            then (record.payload ->> 'amount')::numeric else null end as amount,
          exists (
            select 1
            from jsonb_array_elements_text(
              case when jsonb_typeof(record.payload -> 'tags') = 'array'
                then record.payload -> 'tags' else '[]'::jsonb end
            ) as tag(value)
            where tag.value like 'monzo:%'
          ) as is_monzo
        from owner_records as record
        where record.collection = 'transactions'
          and record.payload ->> 'type' = 'expense'
      ) as transaction
      where transaction_date is not null and amount is not null and amount > 0
      group by date_trunc('month', transaction_date)::date
    ),
    candidates as (
      select
        'faith_practice'::text as evidence_type,
        'self_reported'::text as source_tier,
        'helm:prayerTracking:' || record.record_id as source_reference,
        (helm_private.life_hero_try_date(record.payload ->> 'date')::timestamp
          + interval '12 hours') at time zone 'UTC' as occurred_at,
        helm_private.life_hero_try_date(record.payload ->> 'date') as local_date,
        jsonb_build_object(
          'reason', case record.payload ->> 'status'
            when 'on_time' then 'prayer_completed_on_time'
            else 'prayer_completed_late'
          end,
          'sourceCollection', 'prayerTracking',
          'sourceRecordId', record.record_id,
          'prayer', record.payload ->> 'prayerName',
          'status', record.payload ->> 'status'
        ) as metadata
      from owner_records as record
      where record.collection = 'prayerTracking'
        and record.record_id like 'record:%'
        and record.payload ->> 'status' = any(array['on_time', 'late'])

      union all

      select
        case log.payload ->> 'pillar'
          when 'learn' then 'knowledge_learning'
          else 'vitality_activity'
        end,
        'self_reported',
        'helm:gamification:profile:' || log.profile_field || ':'
          || encode(extensions.digest(log.log_key, 'sha256'), 'hex'),
        (helm_private.life_hero_try_date(log.payload ->> 'date')::timestamp
          + interval '12 hours') at time zone 'UTC',
        helm_private.life_hero_try_date(log.payload ->> 'date'),
        jsonb_build_object(
          'reason', case log.payload ->> 'pillar'
            when 'learn' then 'learn_target_completed'
            else 'move_target_completed'
          end,
          'sourceCollection', 'gamification',
          'sourceRecordId', 'profile',
          'sourceField', log.profile_field,
          'sourceKey', left(log.log_key, 256),
          'sourceKeyHash', encode(extensions.digest(log.log_key, 'sha256'), 'hex'),
          'templateId', log.payload #>> '{template,id}',
          'achievedLevel', helm_private.life_hero_daily_momentum_level(log.payload)
        )
      from momentum_logs as log
      where log.payload ->> 'pillar' = any(array['learn', 'move'])
        and helm_private.life_hero_daily_momentum_level(log.payload) >= 1

      union all

      select
        'discipline_commitment',
        'self_reported',
        'helm:tasks:' || completion.record_id || ':completion:' || case
          when completion.local_date_source = 'explicit'
            then 'local-date:' || completion.local_date::text
          else 'legacy-instant:' || encode(extensions.digest(
            completion.payload ->> 'completedAt', 'sha256'
          ), 'hex')
        end,
        completion.completed_at,
        completion.local_date,
        jsonb_build_object(
          'reason', case when completion.payload ->> 'category' = 'goal'
            then 'goal_completed' else 'task_completed' end,
          'sourceCollection', 'tasks',
          'sourceRecordId', completion.record_id,
          'category', coalesce(completion.payload ->> 'category', 'task'),
          'completedAt', completion.payload ->> 'completedAt',
          'completionLocalDate', completion.local_date,
          'completionTimeZone', completion.time_zone,
          'localDateSource', completion.local_date_source
        )
      from task_completions as completion

      union all

      select
        'financial_progress', 'self_reported',
        'helm:financeBudgets:' || record.record_id || ':created',
        coalesce(
          helm_private.life_hero_try_timestamptz(record.payload ->> 'createdAt'),
          record.created_at
        ),
        coalesce(
          helm_private.life_hero_try_date(left(record.payload ->> 'createdAt', 10)),
          record.created_at::date
        ),
        jsonb_build_object(
          'reason', 'budget_created',
          'sourceCollection', 'financeBudgets',
          'sourceRecordId', record.record_id,
          'category', record.payload ->> 'category'
        )
      from owner_records as record
      where record.collection = 'financeBudgets'
        and coalesce(record.payload ->> 'category', '') <> ''

      union all

      select
        'financial_progress', 'self_reported',
        'helm:savingsGoals:' || record.record_id || ':started',
        coalesce(
          helm_private.life_hero_try_timestamptz(record.payload ->> 'createdAt'),
          record.created_at
        ),
        coalesce(
          helm_private.life_hero_try_date(left(record.payload ->> 'createdAt', 10)),
          record.created_at::date
        ),
        jsonb_build_object(
          'reason', 'savings_goal_started',
          'sourceCollection', 'savingsGoals',
          'sourceRecordId', record.record_id
        )
      from owner_records as record
      where record.collection = 'savingsGoals'

      union all

      select
        'financial_progress', 'self_reported',
        'helm:savingsGoals:' || record.record_id || ':progress',
        progress.occurred_at,
        coalesce(
          helm_private.life_hero_local_date_in_zone(
            progress.occurred_at,
            account.time_zone
          ),
          progress.occurred_at::date
        ),
        jsonb_build_object(
          'reason', 'savings_progress_recorded',
          'sourceCollection', 'savingsGoals',
          'sourceRecordId', record.record_id
        )
      from owner_records as record
      cross join account_context as account
      cross join lateral (
        select coalesce(
          helm_private.life_hero_try_timestamptz(record.payload ->> 'updatedAt'),
          record.updated_at,
          helm_private.life_hero_try_timestamptz(record.payload ->> 'createdAt'),
          record.created_at
        ) as occurred_at
      ) as progress
      where record.collection = 'savingsGoals'
        and jsonb_typeof(record.payload -> 'currentAmount') = 'number'
        and (record.payload ->> 'currentAmount')::numeric > 0

      union all

      select
        'financial_progress', 'self_reported',
        'helm:savingsGoals:' || record.record_id || ':completed:'
          || coalesce(left(record.payload ->> 'completedAt', 10), record.created_at::date::text),
        (coalesce(
          helm_private.life_hero_try_date(left(record.payload ->> 'completedAt', 10)),
          record.created_at::date
        )::timestamp + interval '12 hours') at time zone 'UTC',
        coalesce(
          helm_private.life_hero_try_date(left(record.payload ->> 'completedAt', 10)),
          record.created_at::date
        ),
        jsonb_build_object(
          'reason', 'savings_goal_completed',
          'sourceCollection', 'savingsGoals',
          'sourceRecordId', record.record_id
        )
      from owner_records as record
      where record.collection = 'savingsGoals'
        and record.payload ->> 'completed' = 'true'

      union all

      select
        'financial_progress', 'self_reported',
        'helm:transactions:' || record.record_id || ':saved',
        coalesce(
          helm_private.life_hero_try_timestamptz(record.payload ->> 'createdAt'),
          record.created_at
        ),
        coalesce(
          helm_private.life_hero_try_date(record.payload ->> 'date'),
          record.created_at::date
        ),
        jsonb_build_object(
          'reason', 'transfer_to_savings',
          'sourceCollection', 'transactions',
          'sourceRecordId', record.record_id,
          'provider', case when exists (
            select 1 from jsonb_array_elements_text(
              case when jsonb_typeof(record.payload -> 'tags') = 'array'
                then record.payload -> 'tags' else '[]'::jsonb end
            ) as tag(value) where tag.value like 'monzo:%'
          ) then 'monzo' else 'sabah_one' end
        )
      from owner_records as record
      where record.collection = 'transactions'
        and record.payload ->> 'type' = 'transfer'
        and exists (
          select 1 from owner_records as account
          where account.collection = 'financeAccounts'
            and account.record_id = record.payload ->> 'toAccountId'
            and account.payload ->> 'type' = 'savings'
        )

      union all

      select
        'financial_progress', 'self_reported',
        'helm:transactions:avoidable-spend:' || to_char(current_month.month_start, 'YYYY-MM'),
        ((current_month.month_start + interval '1 month') - interval '1 second')::timestamptz,
        (current_month.month_start + interval '1 month - 1 day')::date,
        jsonb_build_object(
          'reason', 'avoidable_spend_improved',
          'sourceCollection', 'transactions',
          'comparisonMonth', to_char(previous_month.month_start, 'YYYY-MM'),
          'evidenceMonth', to_char(current_month.month_start, 'YYYY-MM'),
          'includesMonzo', current_month.includes_monzo
        )
      from finance_months as current_month
      join finance_months as previous_month
        on previous_month.month_start = (current_month.month_start - interval '1 month')::date
      where current_month.month_start < date_trunc('month', p_as_of_local_date)::date
        and current_month.avoidable_count > 0
        and previous_month.avoidable_count > 0
        and current_month.avoidable_spend < previous_month.avoidable_spend
    )
    select
      candidate.evidence_type,
      candidate.source_tier,
      candidate.source_reference,
      candidate.occurred_at,
      candidate.local_date,
      candidate.metadata
    from candidates as candidate
    where candidate.occurred_at is not null
      and candidate.local_date is not null
      and candidate.local_date <= p_as_of_local_date
      and length(candidate.source_reference) <= 512
    order by candidate.occurred_at, candidate.source_reference
  loop
    v_scanned := v_scanned + 1;
    v_receipt := public.accept_life_hero_evidence(
      'life-sync-v1:' || encode(extensions.digest(
        v_candidate.evidence_type || ':' || v_candidate.source_tier || ':'
          || v_candidate.source_reference,
        'sha256'
      ), 'hex'),
      v_candidate.evidence_type,
      v_candidate.source_tier,
      v_candidate.source_reference,
      v_candidate.occurred_at,
      v_candidate.local_date,
      v_candidate.metadata
    );
    if (v_receipt ->> 'duplicate')::boolean then
      v_duplicates := v_duplicates + 1;
    else
      v_accepted := v_accepted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'scanned', v_scanned,
    'accepted', v_accepted,
    'duplicates', v_duplicates,
    'snapshot', public.get_life_hero_snapshot(p_as_of_local_date)
  );
end;
$$;

revoke all on function public.sync_life_hero_evidence(date) from public, anon;
grant execute on function public.sync_life_hero_evidence(date) to authenticated;

do $$
declare
  v_user record;
  v_previous_claims text := current_setting('request.jwt.claims', true);
begin
  for v_user in select id from auth.users loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', v_user.id,
        'role', 'authenticated',
        'is_anonymous', false
      )::text,
      true
    );
    perform public.sync_life_hero_evidence(current_date);
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_previous_claims, ''), true);
exception when others then
  perform set_config('request.jwt.claims', coalesce(v_previous_claims, ''), true);
  raise;
end;
$$;

comment on function public.sync_life_hero_evidence(date) is
  'Idempotently maps existing database-authoritative life evidence to server-owned Life Hero awards. Raw wealth and product usage never qualify.';

commit;
