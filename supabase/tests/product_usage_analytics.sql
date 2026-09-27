begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

-- Ingest moved to the profile service; this table is read-only, owner-private history.
select has_table('public', 'product_usage_events', 'product usage history is kept');
select hasnt_function(
  'public', 'ingest_product_usage_events', array['jsonb'],
  'the browser ingest RPC is retired'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.product_usage_events'::regclass),
  'product usage events have RLS enabled'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public'
     and tablename = 'product_usage_events'
     and cmd = 'SELECT'
     and roles = array['authenticated']::name[]),
  1,
  'one owner-only read policy exists'
);
select ok(
  has_table_privilege('authenticated', 'public.product_usage_events', 'select'),
  'authenticated accounts can still read their history'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_usage_events', 'insert')
    and not has_table_privilege('authenticated', 'public.product_usage_events', 'update')
    and not has_table_privilege('authenticated', 'public.product_usage_events', 'delete'),
  'authenticated accounts cannot write history'
);

insert into public.product_usage_events (
  user_id, event_id, schema_version, session_id, sequence, event_kind, occurred_at, feature, action,
  release_version, device_class, input_kind, online, reduced_motion
) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 1,
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 'session', '2026-08-30T06:00:00Z', 'application', 'session_started',
   '0.2.125', 'desktop', 'system', true, false),
  ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 1,
   'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 1, 'session', '2026-08-30T07:00:00Z', 'application', 'session_started',
   '0.2.125', 'mobile', 'system', true, true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (select count(*)::integer from public.product_usage_events),
  1,
  'an owner reads only their own history'
);
select throws_ok(
  $$insert into public.product_usage_events (id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12')$$,
  '42501',
  'permission denied for table product_usage_events',
  'direct event writes are denied'
);
select throws_ok(
  $$delete from public.product_usage_events$$,
  '42501',
  'permission denied for table product_usage_events',
  'history cannot be deleted by its owner'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (select count(*)::integer from public.product_usage_events),
  1,
  'a second account cannot read the first owner history'
);

reset role;
select is(
  (select count(*)::integer from public.product_usage_events),
  2,
  'database ownership retains both private histories'
);

set local role anon;
select set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"anon","is_anonymous":true}',
  true
);
select throws_ok(
  $$select * from public.product_usage_events$$,
  '42501',
  'permission denied for table product_usage_events',
  'anonymous sessions cannot read product usage'
);

reset role;
select * from finish();
rollback;
