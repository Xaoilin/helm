begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(35);

select has_table('public', 'product_usage_events', 'private product usage table exists');
select has_function(
  'public', 'ingest_product_usage_events', array['jsonb'],
  'bounded product usage ingest RPC exists'
);
select ok(
  (select prosecdef from pg_proc
   where oid = 'public.ingest_product_usage_events(jsonb)'::regprocedure),
  'product usage ingest derives its owner in a SECURITY DEFINER function'
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
  has_function_privilege('authenticated', 'public.ingest_product_usage_events(jsonb)', 'execute'),
  'authenticated accounts can ingest bounded events'
);
select ok(
  not has_function_privilege('anon', 'public.ingest_product_usage_events(jsonb)', 'execute'),
  'anonymous sessions cannot ingest events'
);
select ok(
  has_table_privilege('authenticated', 'public.product_usage_events', 'select'),
  'authenticated accounts can query their activity'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_usage_events', 'insert')
    and not has_table_privilege('authenticated', 'public.product_usage_events', 'update')
    and not has_table_privilege('authenticated', 'public.product_usage_events', 'delete'),
  'authenticated accounts cannot bypass the ingest RPC'
);
select ok(
  not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.product_usage_events'::regclass
      and confrelid in (
        'public.life_hero_evidence'::regclass,
        'public.life_hero_awards'::regclass
      )
  ),
  'product usage has no Life Hero ledger relationship'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);
select throws_ok(
  $$select public.ingest_product_usage_events(null)$$,
  '22023',
  'Product usage events must be a JSON array.',
  'a signed-in caller cannot submit an absent batch'
);

select is(
  public.ingest_product_usage_events('[
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":1,"kind":"session","occurredAt":"2026-08-30T06:00:00Z","feature":"application","action":"session_started","outcome":"success","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"system","online":true,"reducedMotion":false,"metadata":{"viewportBucket":"desktop","visibilityState":"visible"}},
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":2,"kind":"navigation","occurredAt":"2026-08-30T06:00:01Z","surface":"dashboard","feature":"surface","action":"viewed","outcome":"success","target":"dashboard","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"system","online":true,"reducedMotion":false},
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":3,"kind":"action","occurredAt":"2026-08-30T06:00:02Z","surface":"dashboard","feature":"navigation","action":"surface_selected","target":"tasks","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"pointer","online":true,"reducedMotion":false},
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":4,"kind":"outcome","occurredAt":"2026-08-30T06:00:03Z","surface":"tasks","feature":"navigation","action":"surface_opened","outcome":"success","durationMs":24,"target":"tasks","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"system","online":true,"reducedMotion":false,"metadata":{"previousSurface":"dashboard"}},
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":5,"kind":"error","occurredAt":"2026-08-30T06:00:04Z","surface":"tasks","feature":"surface","action":"render_failed","outcome":"failure","errorCode":"react_render_error","target":"tasks","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"system","online":true,"reducedMotion":false},
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":6,"kind":"performance","occurredAt":"2026-08-30T06:00:05Z","surface":"tasks","feature":"surface","action":"active_duration","durationMs":842,"target":"tasks","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"system","online":true,"reducedMotion":false}
  ]'::jsonb) ->> 'accepted',
  '6',
  'a rich batch accepts six typed content-free events'
);
select is(
  (select count(*)::integer from public.product_usage_events),
  6,
  'all six events are queryable by their owner'
);
select is(
  (select count(distinct event_kind)::integer from public.product_usage_events),
  6,
  'session, navigation, action, outcome, error, and performance are distinct'
);
select is(
  (select duration_ms from public.product_usage_events where event_kind = 'performance'),
  842,
  'latency and active-duration values are queryable'
);
select is(
  (select error_code from public.product_usage_events where event_kind = 'error'),
  'react_render_error',
  'errors use a stable code rather than a raw message'
);
select ok(
  (select metadata = '{"viewportBucket":"desktop","visibilityState":"visible"}'::jsonb
   from public.product_usage_events where event_kind = 'session'),
  'allow-listed device context is retained'
);
select is(
  public.ingest_product_usage_events('[
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":1,"kind":"session","occurredAt":"2026-08-30T06:00:00Z","feature":"application","action":"session_started","outcome":"success","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"system","online":true,"reducedMotion":false,"metadata":{"viewportBucket":"desktop","visibilityState":"visible"}}
  ]'::jsonb) ->> 'accepted',
  '0',
  'an event-id retry does not insert a second row'
);
select is(
  public.ingest_product_usage_events('[
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":1,"kind":"session","occurredAt":"2026-08-30T06:00:00Z","feature":"application","action":"session_started","outcome":"success","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"system","online":true,"reducedMotion":false}
  ]'::jsonb) ->> 'duplicates',
  '1',
  'an event-id retry is reported as a duplicate'
);
select is(
  (select count(*)::integer from public.product_usage_events),
  6,
  'idempotent retries preserve the original event count'
);
select is(
  public.ingest_product_usage_events('[
    {"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":6,"kind":"action","occurredAt":"2026-08-30T06:00:06Z","feature":"navigation","action":"surface_selected","target":"calendar","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"keyboard","online":true,"reducedMotion":false}
  ]'::jsonb) ->> 'duplicates',
  '1',
  'a repeated session sequence is also deduplicated'
);
select throws_ok(
  $$select public.ingest_product_usage_events('[{"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":8,"kind":"action","occurredAt":"2026-08-30T06:00:08Z","feature":"navigation","action":"surface_selected","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"pointer","online":true,"reducedMotion":false,"metadata":{"accessToken":"forbidden"}}]'::jsonb)$$,
  '22023',
  'Product usage metadata must use the content-free allowlist.',
  'tokens cannot enter analytics metadata'
);
select throws_ok(
  $$select public.ingest_product_usage_events('[{"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":9,"kind":"action","occurredAt":"2026-08-30T06:00:09Z","feature":"assistant","action":"submitted","content":"private prompt","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"pointer","online":true,"reducedMotion":false}]'::jsonb)$$,
  '22023',
  'Product usage events contain unsupported fields.',
  'free-form assistant content is rejected'
);
select throws_ok(
  $$select public.ingest_product_usage_events('[{"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":10,"kind":"action","occurredAt":"2026-08-30T06:00:10Z","feature":"finance","action":"transaction_opened","description":"raw merchant text","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"pointer","online":true,"reducedMotion":false}]'::jsonb)$$,
  '22023',
  'Product usage events contain unsupported fields.',
  'raw transaction descriptions are rejected'
);
select throws_ok(
  $$select public.ingest_product_usage_events('[{"eventId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11","schemaVersion":1,"sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","sequence":11,"kind":"action","occurredAt":"2026-08-30T06:00:11Z","feature":"prayer","action":"opened","releaseVersion":"0.2.125","deviceClass":"desktop","inputKind":"pointer","online":true,"reducedMotion":false,"metadata":{"previousSurface":{"prayer":"Fajr"}}}]'::jsonb)$$,
  '22023',
  'Product usage metadata must use the content-free allowlist.',
  'nested domain payloads are rejected'
);
select throws_ok(
  $$insert into public.product_usage_events (id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12')$$,
  '42501',
  'permission denied for table product_usage_events',
  'direct event writes are denied'
);
select is(
  (select count(*)::integer from public.life_hero_evidence),
  0,
  'analytics ingestion creates no Life Hero evidence'
);
select is(
  (select count(*)::integer from public.life_hero_awards),
  0,
  'analytics ingestion creates no Life Hero award'
);
select ok(
  not exists (
    select 1 from public.life_hero_evidence_rules
    where evidence_type in ('app_usage', 'product_usage', 'analytics_event')
  ),
  'analytics still has no Life Hero XP rule'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (select count(*)::integer from public.product_usage_events),
  0,
  'a second account cannot read the first owner history'
);
select is(
  public.ingest_product_usage_events('[
    {"eventId":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","schemaVersion":1,"sessionId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","sequence":1,"kind":"session","occurredAt":"2026-08-30T07:00:00Z","feature":"application","action":"session_started","outcome":"success","releaseVersion":"0.2.125","deviceClass":"mobile","inputKind":"system","online":true,"reducedMotion":true}
  ]'::jsonb) ->> 'accepted',
  '1',
  'the second account can create its own event'
);
select is(
  (select count(*)::integer from public.product_usage_events),
  1,
  'the second account sees only its own event'
);

reset role;
select is(
  (select count(*)::integer from public.product_usage_events),
  7,
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
select throws_ok(
  $$select public.ingest_product_usage_events('[]'::jsonb)$$,
  '42501',
  'permission denied for function ingest_product_usage_events',
  'anonymous sessions cannot execute the ingest RPC'
);

reset role;
select * from finish();
rollback;
