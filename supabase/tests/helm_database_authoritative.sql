begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

select has_table('public', 'helm_records', 'account record table exists');
select has_table('public', 'helm_account_state', 'account version table exists');
select has_table('public', 'helm_mutation_receipts', 'idempotency receipt table exists');
select has_function(
  'public',
  'apply_helm_mutations',
  array['uuid', 'jsonb'],
  'transactional mutation RPC exists'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '33333333-3333-4333-8333-333333333333',
    'authenticated', 'authenticated', 'helm-a@example.test', '', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '44444444-4444-4444-8444-444444444444',
    'authenticated', 'authenticated', 'helm-b@example.test', '', now(), now()
  );

select is(
  (select count(*)::integer from public.helm_account_state
    where user_id in (
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    )),
  2,
  'new auth accounts receive authoritative state before first use'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}',
  true
);

select throws_ok(
  $$insert into public.helm_records (
      user_id, collection, record_id, payload
    ) values (
      '33333333-3333-4333-8333-333333333333', 'tasks', 'direct', '{}'
    )$$,
  '42501',
  'permission denied for table helm_records',
  'authenticated clients cannot write records directly'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '[
      {"op":"create","collection":"tasks","recordId":"task-a","payload":{"id":"task-a","title":"A","completed":false},"position":0},
      {"op":"create","collection":"financeAccounts","recordId":"finance-a","payload":{"id":"finance-a","name":"A"},"position":0}
    ]'::jsonb
  )$$,
  'multi-domain mutations commit through one RPC'
);

select is(
  (select count(*)::integer from public.helm_records where deleted_at is null),
  2,
  'authenticated reads see only the current account records'
);

select is(
  (select count(distinct account_version)::integer from public.helm_records),
  1,
  'one multi-domain request uses one account version'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '[{"op":"create","collection":"gamification","recordId":"profile","payload":{"totalXp":10,"totalTasksCompleted":1}}]'::jsonb
  )$$,
  'counter fixture is created'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '[{"op":"increment","collection":"gamification","recordId":"profile","field":"totalXp","amount":5}]'::jsonb
  )$$,
  'atomic increment succeeds'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    '[{"op":"increment","collection":"gamification","recordId":"profile","field":"totalXp","amount":5}]'::jsonb
  )$$,
  'retrying the same increment request succeeds idempotently'
);

select is(
  (select (payload ->> 'totalXp')::integer from public.helm_records
    where collection = 'gamification' and record_id = 'profile'),
  15,
  'a retried increment is applied exactly once'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
    '[{"op":"patch","collection":"tasks","recordId":"task-a","set":{"title":"First commit"}}]'::jsonb
  )$$,
  'first same-field patch commits'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
    '[{"op":"patch","collection":"tasks","recordId":"task-a","set":{"title":"Second commit"}}]'::jsonb
  )$$,
  'second same-field patch commits'
);

select is(
  (select payload ->> 'title' from public.helm_records
    where collection = 'tasks' and record_id = 'task-a'),
  'Second commit',
  'database commit order deterministically resolves a same-field edit'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
    '[{"op":"delete","collection":"tasks","recordId":"task-a"}]'::jsonb
  )$$,
  'delete creates a tombstone'
);

select throws_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
    '[{"op":"patch","collection":"tasks","recordId":"task-a","set":{"title":"Stale resurrection"}}]'::jsonb
  )$$,
  'P0002',
  'The HELM record cannot be patched because it is missing or deleted.',
  'a stale patch cannot resurrect a tombstone'
);

select isnt(
  (select deleted_at from public.helm_records where collection = 'tasks' and record_id = 'task-a'),
  null::timestamptz,
  'deleted data remains recoverable'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8',
    '[{"op":"restore","collection":"tasks","recordId":"task-a"}]'::jsonb
  )$$,
  'an explicit restore clears the tombstone'
);

select is(
  (select deleted_at from public.helm_records where collection = 'tasks' and record_id = 'task-a'),
  null::timestamptz,
  'restore is explicit rather than a stale update side effect'
);

select throws_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
    '[
      {"op":"create","collection":"tasks","recordId":"must-rollback","payload":{"id":"must-rollback"}},
      {"op":"create","collection":"forgedCollection","recordId":"invalid","payload":{"id":"invalid"}}
    ]'::jsonb
  )$$,
  '22023',
  'Unsupported HELM collection.',
  'an invalid operation rolls back the whole multi-domain request'
);

select is(
  (select count(*)::integer from public.helm_records where record_id = 'must-rollback'),
  0,
  'no partial row survives a failed transaction'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',
    '[{"op":"create","collection":"tasks","recordId":"forged-owner","payload":{"id":"forged-owner","userId":"44444444-4444-4444-8444-444444444444"}}]'::jsonb
  )$$,
  'payload ownership fields cannot change the derived owner'
);

select is(
  (select user_id from public.helm_records where record_id = 'forged-owner'),
  '33333333-3333-4333-8333-333333333333'::uuid,
  'record ownership always comes from auth.uid()'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","is_anonymous":false}',
  true
);

select is(
  (select count(*)::integer from public.helm_records),
  0,
  'RLS hides every other account record'
);

reset role;
set local role anon;
select set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"anon","is_anonymous":true}',
  true
);

select throws_ok(
  $$select public.apply_helm_mutations(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '[{"op":"create","collection":"tasks","recordId":"anonymous","payload":{"id":"anonymous"}}]'::jsonb
  )$$,
  '42501',
  'permission denied for function apply_helm_mutations',
  'anonymous sessions cannot execute the mutation RPC'
);

reset role;
select * from finish();
rollback;
