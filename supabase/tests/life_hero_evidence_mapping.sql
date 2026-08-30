begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

select has_function(
  'public', 'sync_life_hero_evidence', array['date'],
  'KAN-262 source synchronization RPC exists'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.sync_life_hero_evidence(date)'::regprocedure),
  'source synchronization is a bounded SECURITY DEFINER transaction'
);
select ok(
  has_function_privilege('authenticated', 'public.sync_life_hero_evidence(date)', 'execute'),
  'authenticated users can synchronize their own evidence'
);
select ok(
  not has_function_privilege('anon', 'public.sync_life_hero_evidence(date)', 'execute'),
  'anonymous users cannot synchronize evidence'
);

reset role;
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-4333-8333-333333333333',
  'authenticated', 'authenticated', 'kan262-mapping@example.test', '', now(), now()
);
insert into public.helm_records (
  user_id, collection, record_id, payload, revision, account_version, created_at, updated_at
) values
(
  '33333333-3333-4333-8333-333333333333', 'prayerTracking', 'record:2026-08-30:Fajr',
  '{"date":"2026-08-30","prayerName":"Fajr","status":"on_time","recordedAt":"2026-08-30T04:30:00Z"}'::jsonb,
  1, 1, '2026-08-30T04:30:00Z', '2026-08-30T04:30:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'prayerTracking', 'record:2026-08-30:Dhuhr',
  '{"date":"2026-08-30","prayerName":"Dhuhr","status":"missed","recordedAt":"2026-08-30T14:00:00Z"}'::jsonb,
  1, 1, '2026-08-30T14:00:00Z', '2026-08-30T14:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'gamification', 'profile',
  '{"dailyMomentumLearn":{"logs":{"2026-08-30:learn:learn-reading":{"date":"2026-08-30","pillar":"learn","progress":{"pages":5},"updatedAt":"2026-08-30T10:00:00Z"}}},"dailyMomentumMove":{"logs":{"2026-08-30:move:move-walk":{"date":"2026-08-30","pillar":"move","progress":{"walk-minutes":20},"updatedAt":"2026-08-30T11:00:00Z"}}}}'::jsonb,
  1, 1, '2026-08-30T11:00:00Z', '2026-08-30T11:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'knowledgeEntries', 'learning-note',
  '{"id":"learning-note","title":"Read a useful chapter","content":"Notes","createdAt":"2026-08-30T09:00:00Z"}'::jsonb,
  1, 1, '2026-08-30T09:00:00Z', '2026-08-30T09:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'tasks', 'completed-task',
  '{"id":"completed-task","title":"Finish the task","category":"task","completed":true,"completedAt":"2026-08-30T12:00:00Z"}'::jsonb,
  1, 1, '2026-08-29T12:00:00Z', '2026-08-30T12:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'tasks', 'completed-prayer-task',
  '{"id":"completed-prayer-task","title":"Fajr","category":"prayer","prayerName":"Fajr","completed":true,"completedAt":"2026-08-30T04:30:00Z"}'::jsonb,
  1, 1, '2026-08-30T04:00:00Z', '2026-08-30T04:30:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'financeAccounts', 'current-account',
  '{"id":"current-account","name":"Current","type":"current","balance":100000,"currency":"GBP"}'::jsonb,
  1, 1, '2026-08-29T08:00:00Z', '2026-08-29T08:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'financeAccounts', 'savings-account',
  '{"id":"savings-account","name":"Savings","type":"savings","balance":50000,"currency":"GBP"}'::jsonb,
  1, 1, '2026-08-29T08:00:00Z', '2026-08-29T08:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'financeBudgets', 'groceries-budget',
  '{"id":"groceries-budget","category":"groceries","monthlyLimit":50000,"createdAt":"2026-08-30T08:00:00Z"}'::jsonb,
  1, 1, '2026-08-30T08:00:00Z', '2026-08-30T08:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'savingsGoals', 'emergency-fund',
  '{"id":"emergency-fund","name":"Emergency Fund","targetAmount":100000,"currentAmount":25000,"completed":false,"updatedAt":"2026-08-30T08:30:00Z"}'::jsonb,
  1, 1, '2026-08-30T08:30:00Z', '2026-08-30T08:30:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'transactions', 'savings-transfer',
  '{"id":"savings-transfer","type":"transfer","amount":10000,"category":"transfer","accountId":"current-account","toAccountId":"savings-account","date":"2026-08-30","createdAt":"2026-08-30T13:00:00Z"}'::jsonb,
  1, 1, '2026-08-30T13:00:00Z', '2026-08-30T13:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'transactions', 'prior-dining',
  '{"id":"prior-dining","type":"expense","amount":10000,"category":"eating-out","accountId":"current-account","date":"2026-08-29","createdAt":"2026-08-29T13:00:00Z"}'::jsonb,
  1, 1, '2026-08-29T13:00:00Z', '2026-08-29T13:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'transactions', 'reduced-dining',
  '{"id":"reduced-dining","type":"expense","amount":7000,"category":"eating-out","accountId":"current-account","date":"2026-08-30","createdAt":"2026-08-30T14:00:00Z"}'::jsonb,
  1, 1, '2026-08-30T14:00:00Z', '2026-08-30T14:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'transactions', 'prior-subscription',
  '{"id":"prior-subscription","type":"expense","amount":8000,"category":"subscriptions","accountId":"current-account","date":"2026-08-29","createdAt":"2026-08-29T15:00:00Z"}'::jsonb,
  1, 1, '2026-08-29T15:00:00Z', '2026-08-29T15:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'transactions', 'monzo-reduced-subscription',
  '{"id":"monzo-reduced-subscription","type":"expense","amount":5000,"category":"subscriptions","accountId":"current-account","date":"2026-08-31","createdAt":"2026-08-31T14:00:00Z","tags":["monzo:tx-001"]}'::jsonb,
  1, 1, '2026-08-31T14:00:00Z', '2026-08-31T14:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'transactions', 'ordinary-income',
  '{"id":"ordinary-income","type":"income","amount":100000,"category":"salary","accountId":"current-account","date":"2026-08-30","createdAt":"2026-08-30T07:00:00Z"}'::jsonb,
  1, 1, '2026-08-30T07:00:00Z', '2026-08-30T07:00:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'transactions', 'ordinary-expense',
  '{"id":"ordinary-expense","type":"expense","amount":1000,"category":"groceries","accountId":"current-account","date":"2026-08-30","createdAt":"2026-08-30T07:30:00Z"}'::jsonb,
  1, 1, '2026-08-30T07:30:00Z', '2026-08-30T07:30:00Z'
),
(
  '33333333-3333-4333-8333-333333333333', 'product_usage_events', 'not-a-helm-record',
  '{"feature":"ignored"}'::jsonb,
  1, 1, '2026-08-30T07:30:00Z', '2026-08-30T07:30:00Z'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}',
  true
);

select is(
  (public.sync_life_hero_evidence('2026-08-31'::date) ->> 'newEvidence')::integer,
  9,
  'first sync maps Prayer, Learn, Move, tasks, budget, savings, saving, reduced-spend, and Monzo records'
);
select is((select count(*)::integer from public.life_hero_evidence), 9, 'one evidence row exists per positive source event');
select is((select count(*)::integer from public.life_hero_evidence where stat = 'faith'), 1, 'Prayer maps only to Faith');
select is((select count(*)::integer from public.life_hero_evidence where stat = 'knowledge'), 1, 'Learn progress maps to Knowledge');
select is((select count(*)::integer from public.life_hero_evidence where stat = 'vitality'), 1, 'Move maps to Vitality');
select is((select count(*)::integer from public.life_hero_evidence where stat = 'discipline'), 1, 'completed non-prayer tasks map to Discipline');
select is((select count(*)::integer from public.life_hero_evidence where stat = 'finances'), 5, 'budgeting, savings, saving transfer, and reduced avoidable spend map to Finances');
select is((select count(*)::integer from public.life_hero_evidence where source_tier = 'trusted_integration'), 1, 'Monzo evidence is marked as trusted integration');
select ok(
  exists (
    select 1 from public.life_hero_evidence
    where source_reference = 'life-hero:monzo:tx-001'
      and metadata ->> 'sourceCollection' = 'transactions'
      and nullif(metadata ->> 'reason', '') is not null
  ),
  'Monzo evidence retains stable source identity and a deterministic reason'
);
select ok(
  not exists (
    select 1 from public.life_hero_evidence
    where source_reference like '%ordinary-income%'
       or source_reference like '%ordinary-expense%'
       or source_reference like '%financeAccounts%'
  ),
  'wealth, income, ordinary spend, and finance account records do not award XP'
);
select is((select count(*)::integer from public.life_hero_evidence where source_reference like '%completed-prayer-task%'), 0, 'prayer tasks do not duplicate canonical Prayer evidence');
select ok(
  exists (
    select 1 from public.life_hero_evidence
    where source_reference = 'life-hero:prayerTracking:record:2026-08-30:Fajr'
      and metadata ->> 'reason' = 'Prayer Fajr was recorded as on_time on 2026-08-30.'
  ),
  'Prayer reason is deterministic and auditable'
);
select ok(
  exists (
    select 1 from public.life_hero_evidence
    where metadata ->> 'sourceRevision' = '1'
      and metadata ->> 'mappingVersion' = 'life-hero-source-mapping-v1'
  ),
  'mapped evidence records source revision and mapping version'
);
select is((public.sync_life_hero_evidence('2026-08-31'::date) ->> 'newEvidence')::integer, 0, 'repeated sync creates no new evidence');
select is((select count(*)::integer from public.life_hero_evidence), 9, 'repeated sync preserves one ledger row per source identity');
select is(
  (public.get_life_hero_snapshot('2026-09-10'::date) ->> 'totalXp')::integer,
  (select sum(awarded_xp)::integer from public.life_hero_awards),
  'mapped progress is the immutable award total'
);
select is(
  (
    select stat ->> 'condition'
    from jsonb_array_elements(public.get_life_hero_snapshot('2026-09-10'::date) -> 'stats') as stat
    where stat ->> 'stat' = 'faith'
  ),
  'renewal_due',
  'Prayer evidence produces a renewable condition without punishment'
);
select is(
  (public.recompute_life_hero_profile('2026-09-10'::date) ->> 'totalXp')::integer,
  (select total_xp::integer from public.life_hero_profiles),
  'recomputation preserves mapped progress'
);
select ok(
  not exists (
    select 1 from public.life_hero_evidence
    where source_reference like '%product_usage%'
      or source_reference like '%app_usage%'
  ),
  'product usage records have no mapping path into Life Hero XP'
);

reset role;
set local role anon;
select set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"anon","is_anonymous":true}',
  true
);
select throws_ok(
  $$select public.sync_life_hero_evidence('2026-08-31'::date)$$,
  '42501',
  'permission denied for function sync_life_hero_evidence',
  'anonymous users cannot execute source synchronization'
);

reset role;
select * from finish();
rollback;
