begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(15);

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('31800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'scope-a@example.test', now(), now()),
  ('31800000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'scope-b@example.test', now(), now());
insert into public.helm_account_state (user_id, account_version) values
  ('31800000-0000-4000-8000-000000000001', 7)
on conflict (user_id) do update set account_version = excluded.account_version;
insert into public.helm_records (user_id, collection, record_id, payload, account_version, deleted_at) values
  ('31800000-0000-4000-8000-000000000001', 'tasks', 'task-a', '{"id":"task-a"}', 7, null),
  ('31800000-0000-4000-8000-000000000001', 'tasks', 'deleted-a', '{"id":"deleted-a"}', 6, now()),
  ('31800000-0000-4000-8000-000000000001', 'transactions', 'unrelated-a', '{"id":"unrelated-a"}', 5, null),
  ('31800000-0000-4000-8000-000000000001', 'workspaces', 'workspace-a', '{"id":"workspace-a"}', 4, null),
  ('31800000-0000-4000-8000-000000000002', 'tasks', 'other-account', '{"id":"other-account"}', 3, null);

select has_function('public', 'get_helm_account_snapshot_for_collections', array['text[]'], 'scoped snapshot RPC exists');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_helm_account_snapshot_for_collections(text[])'::regprocedure), 'scoped reads retain invoker RLS');
select ok(has_function_privilege('authenticated', 'public.get_helm_account_snapshot_for_collections(text[])', 'execute'), 'authenticated callers can execute scoped reads');
select ok(not has_function_privilege('anon', 'public.get_helm_account_snapshot_for_collections(text[])', 'execute'), 'anonymous role cannot execute scoped reads');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31800000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}', true);
select is(
  public.get_helm_account_snapshot_for_collections(array['tasks']) -> 'state',
  public.get_helm_account_snapshot() -> 'state',
  'scoped snapshot preserves complete authoritative account metadata'
);
select is(
  public.get_helm_account_snapshot_for_collections(array['tasks']) -> 'records',
  (select jsonb_agg(record order by record ->> 'recordId') from jsonb_array_elements(public.get_helm_account_snapshot() -> 'records') as record where record ->> 'collection' = 'tasks'),
  'scoped records preserve the existing shape and tombstones'
);
select is(jsonb_array_length(public.get_helm_account_snapshot_for_collections(array['tasks']) -> 'records'), 2, 'scoped reads exclude unrelated collections and the other account');
select is(public.get_helm_account_snapshot_for_collections(array['inventoryItems']) -> 'records', '[]'::jsonb, 'requested empty collections return authoritative emptiness');
select is(public.get_helm_account_snapshot_for_collections(array[]::text[]) -> 'records', '[]'::jsonb, 'an empty scope does not load the full account');
select is(jsonb_array_length(public.get_helm_account_snapshot_for_collections(array['workspaces']) -> 'records'), 1, 'legacy workspaces remain available when explicitly requested');
select throws_ok($$select public.get_helm_account_snapshot_for_collections(null)$$, '22023', 'Requested Sabah One collections are required.', 'a null scope cannot become a full-account read');

select set_config('request.jwt.claims', '{"sub":"31800000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
select throws_ok($$select public.get_helm_account_snapshot_for_collections(array['tasks'])$$, '42501', 'This session cannot read a Sabah One account snapshot.', 'anonymous authenticated users fail closed');
select set_config('request.jwt.claims', '{"sub":"31800000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false,"client_id":"external-agent"}', true);
select throws_ok($$select public.get_helm_account_snapshot_for_collections(array['tasks'])$$, '42501', 'This session cannot read a Sabah One account snapshot.', 'OAuth clients cannot use generic scoped reads');
select set_config('request.jwt.claims', '{"role":"authenticated","is_anonymous":false}', true);
select throws_ok($$select public.get_helm_account_snapshot_for_collections(array['tasks'])$$, '42501', 'This session cannot read a Sabah One account snapshot.', 'missing account identity fails closed');
reset role;
set local role anon;
select throws_ok($$select public.get_helm_account_snapshot_for_collections(array['tasks'])$$, '42501', 'permission denied for function get_helm_account_snapshot_for_collections', 'anonymous sessions cannot call the RPC');

reset role;
select * from finish();
rollback;
