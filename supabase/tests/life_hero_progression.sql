begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

select has_table('public', 'life_hero_rulesets', 'Life Hero rulesets exist');
select has_table('public', 'life_hero_stat_rules', 'Life Hero stat rules exist');
select has_table('public', 'life_hero_evidence_rules', 'Life Hero evidence rules exist');
select has_table('public', 'life_hero_source_tier_rules', 'Life Hero source tier rules exist');
select has_table('public', 'life_hero_momentum_rules', 'Life Hero momentum rules exist');
select has_table('public', 'life_hero_profiles', 'Life Hero profiles exist');
select has_table('public', 'life_hero_stat_profiles', 'Life Hero stat profiles exist');
select has_table('public', 'life_hero_evidence', 'Life Hero evidence exists');
select has_table('public', 'life_hero_awards', 'Life Hero awards exist');
select has_table('public', 'life_hero_legacy_snapshots', 'Life Hero legacy snapshots exist');
select has_function(
  'public', 'accept_life_hero_evidence',
  array['text', 'text', 'text', 'text', 'timestamp with time zone', 'date', 'jsonb'],
  'atomic Life Hero evidence RPC exists'
);
select has_function(
  'public', 'get_life_hero_snapshot', array['date'],
  'Life Hero snapshot RPC exists'
);
select has_function(
  'public', 'recompute_life_hero_profile', array['date'],
  'Life Hero recomputation RPC exists'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.accept_life_hero_evidence(text,text,text,text,timestamptz,date,jsonb)'::regprocedure),
  'evidence acceptance is a bounded SECURITY DEFINER transaction'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.recompute_life_hero_profile(date)'::regprocedure),
  'recomputation is a bounded SECURITY DEFINER transaction'
);
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.get_life_hero_snapshot(date)'::regprocedure),
  'snapshot reads with invoker privileges'
);
select ok(
  (
    select count(*) = 10 and bool_and(relrowsecurity)
    from pg_class
    where oid = any(array[
      'public.life_hero_rulesets'::regclass,
      'public.life_hero_stat_rules'::regclass,
      'public.life_hero_evidence_rules'::regclass,
      'public.life_hero_source_tier_rules'::regclass,
      'public.life_hero_momentum_rules'::regclass,
      'public.life_hero_profiles'::regclass,
      'public.life_hero_stat_profiles'::regclass,
      'public.life_hero_evidence'::regclass,
      'public.life_hero_awards'::regclass,
      'public.life_hero_legacy_snapshots'::regclass
    ])
  ),
  'every Life Hero table has RLS enabled'
);
select is(
  (select count(*)::integer from public.life_hero_rulesets where is_active),
  1,
  'exactly one Life Hero ruleset is active'
);
select is(
  (select count(*)::integer from public.life_hero_stat_rules where ruleset_version = 'life-hero-v1'),
  7,
  'the active ruleset owns exactly seven stats'
);
select is(
  (select count(*)::integer from public.life_hero_evidence_rules where ruleset_version = 'life-hero-v1'),
  7,
  'the active ruleset owns seven evidence mappings'
);
select ok(
  not exists (
    select 1 from public.life_hero_evidence_rules
    where evidence_type in ('app_usage', 'product_usage', 'analytics_event')
  ),
  'product usage analytics has no award rule'
);
select is(
  (select count(*)::integer from public.life_hero_source_tier_rules where ruleset_version = 'life-hero-v1'),
  3,
  'source trust multipliers are versioned'
);
select is(
  (select count(*)::integer from public.life_hero_momentum_rules where ruleset_version = 'life-hero-v1'),
  4,
  'momentum multipliers are versioned'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.accept_life_hero_evidence(text,text,text,text,timestamptz,date,jsonb)',
    'execute'
  ),
  'authenticated users can submit bounded evidence'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.accept_life_hero_evidence(text,text,text,text,timestamptz,date,jsonb)',
    'execute'
  ),
  'anonymous users cannot submit evidence'
);
select ok(
  not has_table_privilege('authenticated', 'public.life_hero_evidence', 'insert'),
  'authenticated users cannot insert evidence directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.life_hero_awards', 'update'),
  'authenticated users cannot mutate immutable awards'
);
select ok(
  has_table_privilege('authenticated', 'public.life_hero_evidence', 'select'),
  'authenticated users can read owner evidence through RLS'
);
select is(
  (select count(*)::integer from public.life_hero_profiles),
  2,
  'existing authenticated accounts receive initialized profiles'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);

select is(
  jsonb_array_length(public.get_life_hero_snapshot('2026-08-30'::date) -> 'stats'),
  7,
  'an owner snapshot exposes every stat'
);
select is(
  (public.get_life_hero_snapshot('2026-08-30'::date) ->> 'totalXp')::integer,
  0,
  'a new Life Hero profile starts at zero XP'
);
select is(
  public.accept_life_hero_evidence(
    'faith-2026-08-30', 'faith_practice', 'verified', 'prayer:fajr:2026-08-30',
    '2026-08-30T04:30:00Z', '2026-08-30', '{"prayer":"Fajr","onTime":true}'::jsonb
  ) ->> 'duplicate',
  'false',
  'first evidence is accepted as new'
);
select is(
  (select awarded_xp from public.life_hero_awards where stat = 'faith'),
  20,
  'XP comes from the database-owned evidence rule'
);
select is(
  public.accept_life_hero_evidence(
    'faith-2026-08-30', 'faith_practice', 'verified', 'prayer:fajr:2026-08-30',
    '2026-08-30T04:30:00Z', '2026-08-30', '{"prayer":"Fajr","onTime":true}'::jsonb
  ) ->> 'duplicate',
  'true',
  'an idempotent retry returns the first receipt'
);
select is(
  (select count(*)::integer from public.life_hero_evidence),
  1,
  'an idempotent retry does not duplicate evidence'
);
select is(
  (select count(*)::integer from public.life_hero_awards),
  1,
  'an idempotent retry does not duplicate an award'
);
select is(
  public.accept_life_hero_evidence(
    'different-request-key', 'faith_practice', 'verified', 'prayer:fajr:2026-08-30',
    '2026-08-30T04:30:00Z', '2026-08-30', '{}'::jsonb
  ) ->> 'duplicate',
  'true',
  'the same source reference cannot double-award with another request key'
);
select is(
  (select count(*)::integer from public.life_hero_evidence),
  1,
  'source identity deduplication keeps one evidence row'
);
select throws_ok(
  $$select public.accept_life_hero_evidence(
    'faith-2026-08-30', 'faith_practice', 'verified', 'prayer:dhuhr:2026-08-30',
    '2026-08-30T12:30:00Z', '2026-08-30', '{}'::jsonb
  )$$,
  '23505',
  'The Life Hero idempotency key was already used for different evidence.',
  'an idempotency key cannot be reused for different evidence'
);
select throws_ok(
  $$select public.accept_life_hero_evidence(
    'usage-1', 'app_usage', 'verified', 'analytics:dashboard-open',
    '2026-08-30T12:00:00Z', '2026-08-30', '{}'::jsonb
  )$$,
  '22023',
  'This evidence type or source tier cannot award Life Hero XP.',
  'product usage analytics cannot grant XP through the RPC'
);
select throws_ok(
  $$select public.accept_life_hero_evidence(
    'unsafe-1', 'knowledge_learning', 'verified', 'course:unsafe',
    '2026-08-30T12:00:00Z', '2026-08-30', '{"accessToken":"no"}'::jsonb
  )$$,
  '22023',
  'Life Hero evidence metadata must be flat and exclude sensitive fields.',
  'raw credentials cannot enter evidence metadata'
);
select is(
  (public.accept_life_hero_evidence(
    'move-2026-08-28', 'vitality_activity', 'verified', 'move:2026-08-28',
    '2026-08-28T08:00:00Z', '2026-08-28', '{"minutes":20}'::jsonb
  ) -> 'award' ->> 'awardedXp')::integer,
  20,
  'the first momentum day uses the base award'
);
select is(
  (public.accept_life_hero_evidence(
    'move-2026-08-29', 'vitality_activity', 'verified', 'move:2026-08-29',
    '2026-08-29T08:00:00Z', '2026-08-29', '{"minutes":20}'::jsonb
  ) -> 'award' ->> 'momentumDays')::integer,
  2,
  'consecutive real-world days build momentum'
);
select ok(
  (
    select
      (receipt -> 'award' ->> 'momentumDays')::integer = 3
      and (receipt -> 'award' ->> 'momentumMultiplier')::numeric = 1.100
      and (receipt -> 'award' ->> 'awardedXp')::integer = 22
    from (
      select public.accept_life_hero_evidence(
        'move-2026-08-30', 'vitality_activity', 'verified', 'move:2026-08-30',
        '2026-08-30T08:00:00Z', '2026-08-30', '{"minutes":20}'::jsonb
      ) as receipt
    ) as accepted
  ),
  'the third momentum day snapshots and applies the versioned multiplier'
);
select is(
  (public.accept_life_hero_evidence(
    'discipline-2026-08-30', 'discipline_commitment', 'self_reported', 'task:focus:2026-08-30',
    '2026-08-30T09:00:00Z', '2026-08-30', '{"completed":true}'::jsonb
  ) -> 'award' ->> 'awardedXp')::integer,
  11,
  'source confidence is captured in the immutable award'
);
select is(
  (select total_xp::integer from public.life_hero_profiles),
  93,
  'the owner profile is the deterministic sum of immutable awards'
);
select is(
  (select total_xp::integer from public.life_hero_stat_profiles where stat = 'vitality'),
  62,
  'the vitality read model is recomputed from its awards'
);
select is(
  (public.get_life_hero_snapshot('2026-09-10'::date) ->> 'totalXp')::integer,
  93,
  'inactivity conditions never subtract permanent XP'
);
select is(
  (
    select stat ->> 'condition'
    from jsonb_array_elements(public.get_life_hero_snapshot('2026-09-10'::date) -> 'stats') as stat
    where stat ->> 'stat' = 'faith'
  ),
  'renewal_due',
  'neglect is represented only as a temporary condition'
);
select is(
  (public.recompute_life_hero_profile('2026-09-10'::date) ->> 'totalXp')::integer,
  93,
  'explicit recomputation preserves the ledger total'
);
select is(
  (public.recompute_life_hero_profile('2026-09-10'::date) ->> 'totalXp')::integer,
  (public.get_life_hero_snapshot('2026-09-10'::date) ->> 'totalXp')::integer,
  'repeated recomputation is deterministic'
);
select throws_ok(
  $$update public.life_hero_profiles set total_xp = 0$$,
  '42501',
  'permission denied for table life_hero_profiles',
  'authenticated users cannot reduce permanent progress directly'
);
select throws_ok(
  $$insert into public.life_hero_evidence (
    user_id, ruleset_version, stat, evidence_type, source_tier,
    source_reference, idempotency_key, occurred_at, local_date
  ) values (
    '11111111-1111-4111-8111-111111111111', 'life-hero-v1', 'faith',
    'faith_practice', 'verified', 'direct:blocked', 'direct:blocked', now(), current_date
  )$$,
  '42501',
  'permission denied for table life_hero_evidence',
  'authenticated users cannot bypass the atomic evidence RPC'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (public.get_life_hero_snapshot('2026-08-30'::date) ->> 'totalXp')::integer,
  0,
  'a second owner receives independent progression'
);
select is(
  (select count(*)::integer from public.life_hero_awards),
  0,
  'RLS hides the first owner award ledger'
);

reset role;
insert into public.helm_records (
  user_id, collection, record_id, payload, revision, account_version, created_at, updated_at
) values (
  '22222222-2222-4222-8222-222222222222', 'gamification', 'profile',
  '{"totalXp":500,"level":5}'::jsonb, 1, 1, now(), now()
);
select helm_private.capture_life_hero_legacy_snapshot('22222222-2222-4222-8222-222222222222');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',
  true
);
select ok(
  exists (
    select 1 from public.life_hero_legacy_snapshots
    where source_total_xp = 500
      and source_level = 5
      and provenance = 'legacy_gamification_profile_unallocated'
  ),
  'legacy progress is captured with explicit unallocated provenance'
);
select is(
  (select count(*)::integer from public.life_hero_evidence),
  0,
  'legacy snapshots do not invent evidence'
);
select is(
  (select count(*)::integer from public.life_hero_awards),
  0,
  'legacy snapshots never grant guessed XP'
);

reset role;
set local role anon;
select set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"anon","is_anonymous":true}',
  true
);
select throws_ok(
  $$select public.get_life_hero_snapshot('2026-08-30'::date)$$,
  '42501',
  'permission denied for function get_life_hero_snapshot',
  'anonymous users cannot read a Life Hero snapshot'
);
select throws_ok(
  $$select public.accept_life_hero_evidence(
    'anon-1', 'faith_practice', 'verified', 'anon:blocked', now(), current_date, '{}'::jsonb
  )$$,
  '42501',
  'permission denied for function accept_life_hero_evidence',
  'anonymous users cannot execute the award RPC'
);
select throws_ok(
  $$select * from public.life_hero_rulesets$$,
  '42501',
  'permission denied for table life_hero_rulesets',
  'anonymous users cannot read ruleset internals'
);

reset role;
select * from finish();
rollback;
