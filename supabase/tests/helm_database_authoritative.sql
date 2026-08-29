begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(38);

select has_table('public', 'helm_account_state', 'account state schema exists');
select has_table('public', 'helm_records', 'normalized record schema exists');
select has_table('public', 'helm_mutation_receipts', 'mutation receipt schema exists');
select has_function(
  'public', 'apply_helm_mutations', array['uuid', 'jsonb'],
  'authenticated mutation RPC exists'
);
select has_function(
  'public', 'get_helm_account_snapshot', array[]::text[],
  'authenticated snapshot RPC exists'
);
select ok(
  not (select prosecdef from pg_proc where oid = 'public.get_helm_account_snapshot()'::regprocedure),
  'snapshot RPC runs with invoker privileges'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.helm_account_state'::regclass),
  'account state has row-level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.helm_records'::regclass),
  'normalized records have row-level security enabled'
);
select ok(
  has_function_privilege('authenticated', 'public.apply_helm_mutations(uuid, jsonb)', 'execute'),
  'authenticated role can execute the mutation RPC'
);
select ok(
  (
    select internal_function.prosecdef
      and internal_function.proowner = public_function.proowner
    from pg_proc as internal_function
    cross join pg_proc as public_function
    where internal_function.oid = 'helm_private.apply_helm_mutations_direct(uuid, jsonb)'::regprocedure
      and public_function.oid = 'public.apply_helm_mutations(uuid, jsonb)'::regprocedure
  ),
  'internal mutation function remains SECURITY DEFINER with its established owner'
);
select ok(
  not has_function_privilege('anon', 'public.apply_helm_mutations(uuid, jsonb)', 'execute'),
  'anonymous callers cannot execute the mutation RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.helm_records', 'insert'),
  'authenticated role cannot write normalized records directly'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);

select is(
  public.get_helm_account_snapshot() -> 'state' ->> 'userId',
  '11111111-1111-4111-8111-111111111111',
  'snapshot state is derived from the authenticated account'
);
select is(
  (public.get_helm_account_snapshot() -> 'state' ->> 'accountVersion')::bigint,
  1::bigint,
  'migration establishes the account version at one'
);
select is(
  jsonb_array_length(public.get_helm_account_snapshot() -> 'records'),
  4,
  'snapshot contains only the owner records'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.get_helm_account_snapshot() -> 'records') as record
    where record ->> 'userId' = '22222222-2222-4222-8222-222222222222'
  ),
  'snapshot does not cross account boundaries'
);

select is(
  (
    public.apply_helm_mutations(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
      '[{"op":"create","collection":"tasks","recordId":"live-a","payload":{"id":"live-a","title":"Created in transaction","completed":false}}]'::jsonb
    ) ->> 'accountVersion'
  )::bigint,
  2::bigint,
  'a committed mutation advances the account version once'
);
select is(
  (select payload ->> 'title'
   from public.helm_records
   where user_id = '11111111-1111-4111-8111-111111111111'
     and collection = 'tasks'
     and record_id = 'live-a'),
  'Created in transaction',
  'mutation ownership is derived from auth.uid'
);
select is(
  (
    public.apply_helm_mutations(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
      '[{"op":"create","collection":"tasks","recordId":"live-a","payload":{"id":"live-a","title":"Different retry","completed":true}}]'::jsonb
    ) ->> 'accountVersion'
  )::bigint,
  2::bigint,
  'reusing a request id returns the committed result'
);
select is(
  (select count(*)::integer
   from public.helm_records
   where user_id = '11111111-1111-4111-8111-111111111111'
     and collection = 'tasks'
     and record_id = 'live-a'),
  1,
  'an idempotent retry does not insert a second record'
);
select throws_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002',
    '[{"op":"create","collection":"tasks","recordId":"live-a","payload":{"id":"live-a","title":"Conflicting create","completed":true}}]'::jsonb
  )$$,
  '23505',
  'A HELM record with this id already exists.',
  'a different request cannot create an existing record'
);
select is(
  (
    public.apply_helm_mutations(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003',
      '[{"op":"patch","collection":"tasks","recordId":"live-a","set":{"title":"Patched in transaction"}}]'::jsonb
    ) ->> 'accountVersion'
  )::bigint,
  3::bigint,
  'a patch advances the account version once'
);
select is(
  (select revision
   from public.helm_records
   where user_id = '11111111-1111-4111-8111-111111111111'
     and collection = 'tasks'
     and record_id = 'live-a'),
  2::bigint,
  'a patch advances the record revision'
);
select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004',
    '[{"op":"delete","collection":"tasks","recordId":"live-a"}]'::jsonb
  )$$,
  'a delete is represented by a committed tombstone'
);
select ok(
  (select deleted_at is not null and revision = 3
   from public.helm_records
   where user_id = '11111111-1111-4111-8111-111111111111'
     and collection = 'tasks'
     and record_id = 'live-a'),
  'delete advances revision without removing the row'
);
select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0005',
    '[{"op":"restore","collection":"tasks","recordId":"live-a"}]'::jsonb
  )$$,
  'a tombstone can be restored through the mutation RPC'
);
select ok(
  (select deleted_at is null and revision = 4
   from public.helm_records
   where user_id = '11111111-1111-4111-8111-111111111111'
     and collection = 'tasks'
     and record_id = 'live-a'),
  'restore advances the revision and clears the tombstone'
);
reset role;
select is(
  (select count(*)::integer
   from public.helm_mutation_receipts
   where user_id = '11111111-1111-4111-8111-111111111111'),
  4,
  'only committed requests receive idempotency receipts'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (public.get_helm_account_snapshot() -> 'state' ->> 'accountVersion')::bigint,
  5::bigint,
  'snapshot revision reflects the committed mutation sequence'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(public.get_helm_account_snapshot() -> 'records') as record
    where record ->> 'recordId' = 'live-a'
      and record ->> 'deletedAt' is null
      and record -> 'payload' ->> 'title' = 'Patched in transaction'
  ),
  'snapshot exposes the complete restored record'
);
select is(
  (
    public.apply_helm_mutations(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0006',
      '[{"op":"create","collection":"employment","recordId":"employment-fix","payload":{"id":"employment-fix","company":"Example Ltd","role":"Backend Engineer","status":"lead"}}]'::jsonb
    ) ->> 'accountVersion'
  )::bigint,
  6::bigint,
  'an authenticated session can mutate the Employment collection'
);
select is(
  (select payload ->> 'company'
   from public.helm_records
   where user_id = '11111111-1111-4111-8111-111111111111'
     and collection = 'employment'
     and record_id = 'employment-fix'),
  'Example Ltd',
  'Employment mutations persist through the normalized record boundary'
);
select throws_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0007',
    '[{"op":"create","collection":"inventoryItems","recordId":"blocked-inventory","payload":{"id":"blocked-inventory"}}]'::jsonb
  )$$,
  '42501',
  'Inventory mutations must use the bounded Inventory interface.',
  'the generic mutation RPC still excludes Inventory mutations'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  public.get_helm_account_snapshot() -> 'state' ->> 'userId',
  '22222222-2222-4222-8222-222222222222',
  'a second account receives its own snapshot state'
);
select is(
  jsonb_array_length(public.get_helm_account_snapshot() -> 'records'),
  1,
  'the second account sees only its own normalized records'
);
select ok(
  not exists (
    select 1
    from public.helm_records
    where user_id = '11111111-1111-4111-8111-111111111111'
  ),
  'RLS hides the first account records from the second account'
);
select throws_ok(
  $$insert into public.helm_records (
    user_id, collection, record_id, payload, revision, account_version
  ) values (
    '22222222-2222-4222-8222-222222222222', 'tasks', 'direct-write', '{}', 1, 2
  )$$,
  '42501',
  'permission denied for table helm_records',
  'authenticated callers cannot bypass the mutation RPC'
);

reset role;
set local role anon;
select set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"anon","is_anonymous":true}',
  true
);
select throws_ok(
  $$select public.get_helm_account_snapshot()$$,
  '42501',
  'permission denied for function get_helm_account_snapshot',
  'anonymous callers cannot execute the account snapshot RPC'
);

reset role;
select * from finish();
rollback;
