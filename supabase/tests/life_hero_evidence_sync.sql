begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

select has_function(
  'public', 'sync_life_hero_evidence', array['date'],
  'Life Hero account evidence sync RPC exists'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.sync_life_hero_evidence(date)'::regprocedure),
  'evidence sync is a bounded SECURITY DEFINER operation'
);
select ok(
  has_function_privilege('authenticated', 'public.sync_life_hero_evidence(date)', 'execute'),
  'authenticated accounts can reconcile their own evidence'
);
select ok(
  not has_function_privilege('anon', 'public.sync_life_hero_evidence(date)', 'execute'),
  'anonymous sessions cannot reconcile Life Hero evidence'
);

insert into public.helm_records (
  user_id, collection, record_id, payload, revision, account_version, created_at, updated_at
) values
  (
    '11111111-1111-4111-8111-111111111111', 'prayerTracking', 'record:2026-05-01:Fajr',
    '{"date":"2026-05-01","prayerName":"Fajr","status":"on_time","recordedAt":"2026-05-01T04:30:00Z"}',
    1, 10, '2026-05-01T04:30:00Z', '2026-05-01T04:30:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'prayerTracking', 'record:2026-05-01:Dhuhr',
    '{"date":"2026-05-01","prayerName":"Dhuhr","status":"missed","recordedAt":"2026-05-01T13:00:00Z"}',
    1, 10, '2026-05-01T13:00:00Z', '2026-05-01T13:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'tasks', 'completed-task',
    '{"id":"completed-task","title":"Complete the plan","completed":true,"completedAt":"2026-06-03T10:00:00Z","category":"task"}',
    1, 10, '2026-06-01T10:00:00Z', '2026-06-03T10:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'tasks', 'prayer-task',
    '{"id":"prayer-task","title":"Fajr","completed":true,"completedAt":"2026-06-03T04:30:00Z","category":"prayer"}',
    1, 10, '2026-06-01T04:30:00Z', '2026-06-03T04:30:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'financeAccounts', 'savings-account',
    '{"id":"savings-account","name":"Savings","type":"savings","balance":99999999}',
    1, 10, '2026-06-01T09:00:00Z', '2026-06-01T09:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'financeBudgets', 'food-budget',
    '{"id":"food-budget","category":"eating-out","monthlyLimit":10000,"createdAt":"2026-06-01T09:00:00Z"}',
    1, 10, '2026-06-01T09:00:00Z', '2026-06-01T09:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'savingsGoals', 'emergency-goal',
    '{"id":"emergency-goal","name":"Emergency fund","targetAmount":100000,"currentAmount":50000,"completed":true,"createdAt":"2026-06-02T09:00:00Z","completedAt":"2026-08-20T09:00:00Z"}',
    1, 10, '2026-06-02T09:00:00Z', '2026-08-20T09:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'transactions', 'saved-transfer',
    '{"id":"saved-transfer","type":"transfer","amount":25000,"accountId":"current-account","toAccountId":"savings-account","category":"transfer","date":"2026-08-15","createdAt":"2026-08-15T12:00:00Z"}',
    1, 10, '2026-08-15T12:00:00Z', '2026-08-15T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'transactions', 'july-avoidable',
    '{"id":"july-avoidable","type":"expense","amount":12000,"category":"eating-out","accountId":"current-account","date":"2026-07-10","createdAt":"2026-07-10T12:00:00Z","tags":["monzo:july"]}',
    1, 10, '2026-07-10T12:00:00Z', '2026-07-10T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'transactions', 'august-avoidable',
    '{"id":"august-avoidable","type":"expense","amount":6000,"category":"eating-out","accountId":"current-account","date":"2026-08-10","createdAt":"2026-08-10T12:00:00Z","tags":["monzo:august"]}',
    1, 10, '2026-08-10T12:00:00Z', '2026-08-10T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111', 'transactions', 'salary-income',
    '{"id":"salary-income","type":"income","amount":99999999,"category":"salary","accountId":"current-account","date":"2026-08-25","createdAt":"2026-08-25T12:00:00Z","tags":["monzo:salary"]}',
    1, 10, '2026-08-25T12:00:00Z', '2026-08-25T12:00:00Z'
  )
on conflict (user_id, collection, record_id) do update set
  payload = excluded.payload,
  deleted_at = null,
  updated_at = excluded.updated_at;

insert into public.helm_records (
  user_id, collection, record_id, payload, revision, account_version, created_at, updated_at
) values (
  '11111111-1111-4111-8111-111111111111', 'gamification', 'profile',
  '{
    "totalXp":0,
    "level":1,
    "dailyMomentumLearn":{"logs":{"2026-06-04:learn:reading":{"date":"2026-06-04","pillar":"learn","updatedAt":"2026-06-04T12:00:00Z","template":{"id":"reading","levels":[{"level":1,"steps":[{"id":"pages","amount":2}]}]},"progress":{"pages":2}}}},
    "dailyMomentumMove":{"logs":{"2026-06-05:move:walk":{"date":"2026-06-05","pillar":"move","updatedAt":"2026-06-05T12:00:00Z","template":{"id":"walk","levels":[{"level":1,"steps":[{"id":"minutes","amount":5}]}]},"progress":{"minutes":5}}}}
  }'::jsonb,
  2, 10, '2026-06-01T00:00:00Z', '2026-06-05T12:00:00Z'
)
on conflict (user_id, collection, record_id) do update set
  payload = public.helm_records.payload || excluded.payload,
  deleted_at = null,
  updated_at = excluded.updated_at;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);

select is(
  (public.sync_life_hero_evidence('2026-09-01') ->> 'accepted')::integer,
  10,
  'the first sync backfills every qualifying existing behavior'
);
select is(
  (select count(*)::integer from public.life_hero_evidence),
  10,
  'the backfill creates one evidence row per stable source identity'
);
select is(
  (select count(*)::integer from public.life_hero_awards),
  10,
  'the backfill creates one immutable award per evidence row'
);
select is(
  (select count(*)::integer from public.life_hero_evidence where stat = 'faith'),
  1,
  'positive Prayer completion maps to Faith while missed Prayer does not award XP'
);
select is(
  (select count(*)::integer from public.life_hero_evidence where stat = 'knowledge'),
  1,
  'a completed Learn target maps to Knowledge'
);
select is(
  (select count(*)::integer from public.life_hero_evidence where stat = 'vitality'),
  1,
  'a completed Move target maps to Vitality'
);
select is(
  (select count(*)::integer from public.life_hero_evidence where stat = 'discipline'),
  1,
  'completed non-prayer Sabah One tasks map to Discipline without double-counting Prayer tasks'
);
select is(
  (select count(*)::integer from public.life_hero_evidence where stat = 'finances'),
  6,
  'budgeting, savings milestones, saving transfers, and spend improvement map to Finances'
);
select ok(
  not exists (
    select 1 from public.life_hero_evidence
    where metadata ->> 'reason' is null
      or metadata ->> 'sourceCollection' is null
      or source_reference = ''
  ),
  'every synchronized award keeps an auditable reason and source provenance'
);
select ok(
  exists (
    select 1 from public.life_hero_evidence
    where metadata ->> 'reason' = 'avoidable_spend_improved'
      and metadata ->> 'includesMonzo' = 'true'
  ),
  'Monzo records contribute through evidenced spending improvement'
);
select ok(
  not exists (
    select 1 from public.life_hero_evidence
    where metadata ->> 'reason' in ('account_balance', 'income_received', 'net_worth')
  ),
  'raw balances, income, and wealth never produce finance rewards'
);
select is(
  (public.sync_life_hero_evidence('2026-09-01') ->> 'accepted')::integer,
  0,
  'repeated sync accepts no duplicate evidence'
);
select is(
  (public.sync_life_hero_evidence('2026-09-01') ->> 'duplicates')::integer,
  10,
  'repeated sync returns an auditable duplicate receipt for every source'
);
select is(
  (public.get_life_hero_snapshot('2026-09-01') ->> 'totalXp')::integer,
  170,
  'database-owned rules award the deterministic expected XP total'
);
select is(
  (
    select stat ->> 'condition'
    from jsonb_array_elements(public.get_life_hero_snapshot('2026-09-01') -> 'stats') as stat
    where stat ->> 'stat' = 'faith'
  ),
  'renewal_due',
  'Prayer weakness is a renewable status after positive progress ages'
);
select is(
  (public.get_life_hero_snapshot('2026-09-01') ->> 'totalXp')::integer,
  170,
  'renewal status never subtracts permanent progress'
);

reset role;
select * from finish();
rollback;
