begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Agent OAuth approvals stay in Supabase: the browser approves, lists and revokes each domain
-- independently, and no OAuth client can approve itself or reach the Vault secrets.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'approvals-owner@example.test', '', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'approvals-other@example.test', '', now(), now());

select ok((select relrowsecurity from pg_class where oid = 'public.helm_inventory_oauth_clients'::regclass), 'inventory approvals use RLS');
select ok(not has_table_privilege('authenticated', 'public.helm_inventory_oauth_clients', 'select,insert,update,delete'), 'inventory approval storage is not directly exposed');
select ok(not has_function_privilege('anon', 'public.approve_inventory_oauth_client(text,text)', 'execute'), 'anonymous callers cannot approve inventory agents');
select ok(has_function_privilege('authenticated', 'public.list_inventory_oauth_clients()', 'execute'), 'signed-in callers can list inventory approvals');
select ok((select relrowsecurity from pg_class where oid = 'public.helm_employment_oauth_clients'::regclass), 'employment approvals use RLS');
select ok(not has_table_privilege('authenticated', 'public.helm_employment_oauth_clients', 'select,insert,update,delete'), 'employment approval storage is not directly exposed');
select ok(not has_function_privilege('anon', 'public.approve_employment_oauth_client(text,text)', 'execute'), 'anonymous callers cannot approve employment agents');
select ok(has_function_privilege('authenticated', 'public.list_employment_oauth_clients()', 'execute'), 'signed-in callers can list employment approvals');
select ok((select relrowsecurity from pg_class where oid = 'public.helm_equity_oauth_clients'::regclass), 'equity approvals use RLS');
select ok(not has_table_privilege('authenticated', 'public.helm_equity_oauth_clients', 'select,insert,update,delete'), 'equity approval storage is not directly exposed');
select ok(not has_function_privilege('anon', 'public.approve_equity_oauth_client(text,text)', 'execute'), 'anonymous callers cannot approve equity agents');
select ok(has_function_privilege('authenticated', 'public.list_equity_oauth_clients()', 'execute'), 'signed-in callers can list equity approvals');
select ok((select relrowsecurity from pg_class where oid = 'public.helm_finance_oauth_clients'::regclass), 'finance approvals use RLS');
select ok(not has_table_privilege('authenticated', 'public.helm_finance_oauth_clients', 'select,insert,update,delete'), 'finance approval storage is not directly exposed');
select ok(not has_function_privilege('anon', 'public.approve_finance_oauth_client(text,text)', 'execute'), 'anonymous callers cannot approve finance agents');
select ok(has_function_privilege('authenticated', 'public.list_finance_oauth_clients()', 'execute'), 'signed-in callers can list finance approvals');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}', true);
select is(public.approve_inventory_oauth_client('domain-agent', 'Domain agent') ->> 'clientId', 'domain-agent', 'the browser approves an agent for inventory');
select is(jsonb_array_length(public.list_inventory_oauth_clients()), 1, 'the browser lists its inventory approval');
select is(public.approve_employment_oauth_client('domain-agent', 'Domain agent') ->> 'clientId', 'domain-agent', 'the browser approves an agent for employment');
select is(jsonb_array_length(public.list_employment_oauth_clients()), 1, 'the browser lists its employment approval');
select is(public.approve_equity_oauth_client('domain-agent', 'Domain agent') ->> 'clientId', 'domain-agent', 'the browser approves an agent for equity');
select is(jsonb_array_length(public.list_equity_oauth_clients()), 1, 'the browser lists its equity approval');
select is(public.approve_finance_oauth_client('domain-agent', 'Domain agent') ->> 'clientId', 'domain-agent', 'the browser approves an agent for finance');
select is(jsonb_array_length(public.list_finance_oauth_clients()), 1, 'the browser lists its finance approval');
select lives_ok($$select public.revoke_inventory_oauth_client('domain-agent')$$, 'the browser revokes one domain');
select ok(public.list_inventory_oauth_clients() -> 0 ->> 'revokedAt' is not null, 'the revoked approval records when');
select ok(public.list_employment_oauth_clients() -> 0 ->> 'revokedAt' is null, 'revoking one domain leaves the others approved');
select throws_ok($$select public.revoke_finance_oauth_client('unknown-agent')$$, 'P0002', 'Approved OAuth client was not found.', 'revoking an unknown agent fails');

select set_config('request.jwt.claims', '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"domain-agent"}', true);
select throws_ok($$select public.approve_inventory_oauth_client('domain-agent', 'Self approval')$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot approve itself for inventory');
select throws_ok($$select public.list_inventory_oauth_clients()$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot list inventory approvals');
select throws_ok($$select public.approve_employment_oauth_client('domain-agent', 'Self approval')$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot approve itself for employment');
select throws_ok($$select public.list_employment_oauth_clients()$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot list employment approvals');
select throws_ok($$select public.approve_equity_oauth_client('domain-agent', 'Self approval')$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot approve itself for equity');
select throws_ok($$select public.list_equity_oauth_clients()$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot list equity approvals');
select throws_ok($$select public.approve_finance_oauth_client('domain-agent', 'Self approval')$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot approve itself for finance');
select throws_ok($$select public.list_finance_oauth_clients()$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot list finance approvals');
select throws_ok($$select public.list_helm_secrets()$$, '42501', 'OAuth clients cannot use this Sabah One interface.', 'an OAuth client cannot reach the Vault secrets');

select set_config('request.jwt.claims', '{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}', true);
select is(jsonb_array_length(public.list_inventory_oauth_clients()), 0, 'another account sees none of the first account''s inventory approvals');
select is(jsonb_array_length(public.list_employment_oauth_clients()), 0, 'another account sees none of the first account''s employment approvals');
select is(jsonb_array_length(public.list_equity_oauth_clients()), 0, 'another account sees none of the first account''s equity approvals');
select is(jsonb_array_length(public.list_finance_oauth_clients()), 0, 'another account sees none of the first account''s finance approvals');

reset role;
select * from finish();
rollback;
