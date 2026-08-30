begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

select has_table('public', 'github_life_hero_connections', 'GitHub Life Hero connections exist');
select has_table('public', 'github_life_hero_oauth_states', 'GitHub OAuth state records exist');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.github_life_hero_connections'::regclass),
  'GitHub connection metadata has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.github_life_hero_oauth_states'::regclass),
  'GitHub OAuth states have RLS enabled'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'github_life_hero_connections'
      and column_name = 'vault_secret_id'
  ),
  'GitHub credentials use a Vault reference'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'github_life_hero_connections'
      and column_name in ('access_token', 'refresh_token', 'client_secret', 'private_key')
  ),
  'GitHub token values are not stored in shared connection rows'
);
select ok(
  not has_table_privilege('authenticated', 'public.github_life_hero_connections', 'select')
    and not has_table_privilege('authenticated', 'public.github_life_hero_connections', 'insert')
    and not has_table_privilege('authenticated', 'public.github_life_hero_connections', 'update')
    and not has_table_privilege('authenticated', 'public.github_life_hero_connections', 'delete'),
  'Authenticated clients cannot read or write GitHub connection rows directly'
);
select ok(
  not has_table_privilege('anon', 'public.github_life_hero_oauth_states', 'select'),
  'Anonymous clients cannot read GitHub OAuth state rows'
);

select has_function(
  'public', 'save_github_life_hero_credential',
  array['uuid', 'bigint', 'text', 'text', 'timestamp with time zone', 'timestamp with time zone', 'bigint', 'text'],
  'Vault-backed GitHub credential writer exists'
);
select has_function(
  'public', 'accept_github_life_hero_evidence',
  array['uuid', 'jsonb', 'date'],
  'Atomic GitHub Life Hero evidence writer exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.save_github_life_hero_credential(uuid,bigint,text,text,timestamptz,timestamptz,bigint,text)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.save_github_life_hero_credential(uuid,bigint,text,text,timestamptz,timestamptz,bigint,text)',
    'execute'
  ),
  'Only the hosted service role can write GitHub credentials'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.accept_github_life_hero_evidence(uuid,jsonb,date)',
    'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.accept_github_life_hero_evidence(uuid,jsonb,date)',
    'execute'
  ),
  'Only the hosted service role can invoke the GitHub evidence batch'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.save_github_life_hero_credential(uuid,bigint,text,text,timestamptz,timestamptz,bigint,text)'::regprocedure),
  'GitHub credential storage is SECURITY DEFINER'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.accept_github_life_hero_evidence(uuid,jsonb,date)'::regprocedure),
  'GitHub evidence acceptance is SECURITY DEFINER'
);
select ok(
  (select pg_get_functiondef('public.accept_github_life_hero_evidence(uuid,jsonb,date)'::regprocedure) ~ 'craft_practice'),
  'GitHub batch fixes the evidence kind to craft practice'
);
select ok(
  (select pg_get_functiondef('public.accept_github_life_hero_evidence(uuid,jsonb,date)'::regprocedure) ~ 'trusted_integration'),
  'GitHub batch fixes the trusted integration tier'
);
select ok(
  (select pg_get_functiondef('public.accept_github_life_hero_evidence(uuid,jsonb,date)'::regprocedure) ~ 'jsonb_array_length\(p_candidates\) > 500'),
  'GitHub evidence batches are bounded before the atomic award path'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.life_hero_evidence'::regclass
      and tgname = 'guard_github_trusted_life_hero_evidence'
  ),
  'Trusted GitHub evidence has a database guard'
);
select ok(
  (select pg_get_functiondef('helm_private.guard_github_trusted_life_hero_evidence()'::regprocedure) ~ 'helm.github_life_hero_verified'),
  'The GitHub evidence guard requires the hosted verification marker'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);
select throws_ok(
  $$select public.accept_life_hero_evidence(
    'github-direct-blocked', 'craft_practice', 'trusted_integration', 'github:direct:blocked',
    '2026-08-30T12:00:00Z', '2026-08-30', '{}'::jsonb
  )$$,
  '42501',
  'Trusted GitHub Craft evidence must come from the hosted verification route.',
  'direct callers cannot fabricate trusted GitHub evidence'
);

reset role;
set local role service_role;
select set_config(
  'request.jwt.claims',
  '{"sub":"service-role","role":"service_role","is_anonymous":false}',
  true
);
select is(
  (public.accept_github_life_hero_evidence(
    '11111111-1111-4111-8111-111111111111',
    '[{"idempotencyKey":"github-app-v1:123:PR_node_10","sourceReference":"github:repository:123:pull-request:PR_node_10","occurredAt":"2026-08-30T12:00:00Z","localDate":"2026-08-30","metadata":{"provider":"github","apiVersion":"2022-11-28","repositoryId":"123","pullRequestNodeId":"PR_node_10","authorizedUserId":"42","mergedAt":"2026-08-30T12:00:00Z","localDate":"2026-08-30","reason":"authored_pull_request_merged"}}]'::jsonb,
    '2026-08-30'::date
  ) ->> 'accepted')::integer,
  1,
  'the hosted GitHub batch accepts one verified candidate'
);
select is(
  (public.accept_github_life_hero_evidence(
    '11111111-1111-4111-8111-111111111111',
    '[{"idempotencyKey":"github-app-v1:123:PR_node_10","sourceReference":"github:repository:123:pull-request:PR_node_10","occurredAt":"2026-08-30T12:00:00Z","localDate":"2026-08-30","metadata":{"provider":"github","apiVersion":"2022-11-28","repositoryId":"123","pullRequestNodeId":"PR_node_10","authorizedUserId":"42","mergedAt":"2026-08-30T12:00:00Z","localDate":"2026-08-30","reason":"authored_pull_request_merged"}}]'::jsonb,
    '2026-08-30'::date
  ) ->> 'duplicates')::integer,
  1,
  'replaying the hosted GitHub batch returns one duplicate'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (select count(*)::integer from public.life_hero_evidence where source_reference = 'github:repository:123:pull-request:PR_node_10'),
  1,
  'GitHub replay does not create a second evidence row'
);
select is(
  (select count(*)::integer from public.life_hero_awards),
  1,
  'GitHub replay does not create a second award'
);
select is(
  (select awarded_xp from public.life_hero_awards limit 1),
  20,
  'GitHub progression uses the database-owned fixed Craft award'
);

select * from finish();
rollback;
