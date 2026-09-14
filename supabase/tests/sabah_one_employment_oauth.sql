begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','e1111111-1111-4111-8111-111111111111','authenticated','authenticated','employment-owner@example.test','',now(),now()),
  ('00000000-0000-0000-0000-000000000000','e2222222-2222-4222-8222-222222222222','authenticated','authenticated','employment-other@example.test','',now(),now());

select ok((select relrowsecurity from pg_class where oid='public.helm_employment_oauth_clients'::regclass),
  'Employment approvals have RLS');
select ok((select relrowsecurity from pg_class where oid='public.helm_employment_mutation_receipts'::regclass),
  'Employment receipts have RLS');
select ok(not has_table_privilege('authenticated','public.helm_employment_oauth_clients','select'),
  'Employment approval storage is not directly exposed');
select ok(not has_table_privilege('authenticated','public.helm_employment_mutation_receipts','select'),
  'Employment receipts are not directly exposed');
select ok(not has_function_privilege('authenticated','helm_private.mutate_employment(uuid,text,text,jsonb,text)','execute'),
  'private mutation engine is not caller-executable');
select ok(not has_function_privilege('anon','public.employment_list_applications(text,text,integer,integer,text,text)','execute'),
  'anonymous users cannot execute Employment reads');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select is(public.employment_list_applications() -> 'applications','[]'::jsonb,'new direct account starts with no applications');
select lives_ok($$select public.employment_add_application('e0000000-0000-4000-8000-000000000001',
  '{"id":"preserved-job","company":"Other company","role":"Engineer","notes":"Keep this unchanged"}')$$,
  'direct app can create an application through the semantic boundary');
select set_config('employment.test.preserved',(public.employment_get_application('preserved-job')->'application')::text,true);
select lives_ok($$select public.approve_inventory_oauth_client('inventory-only','Inventory client')$$,
  'Inventory can be approved independently');
select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"inventory-only"}',true);
select throws_ok($$select public.employment_list_applications()$$,'42501',
  'This OAuth client is not approved for Sabah One Employment.','Inventory approval does not grant Employment');
select throws_ok($$select public.approve_employment_oauth_client('inventory-only','Self approval')$$,'42501',
  'OAuth clients cannot use this Sabah One interface.','an OAuth client cannot approve itself');
select throws_ok($$select public.employment_add_application('e0000000-0000-4000-8000-000000000002',
  '{"company":"micro1","role":"AI projects"}')$$,'42501',
  'This OAuth client is not approved for Sabah One Employment.','unapproved OAuth writes fail closed');

select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select is(public.approve_employment_oauth_client('jobs-client','Scheduled jobs agent')->>'clientId','jobs-client',
  'a direct signed-in session approves the separate Employment client');
select is(jsonb_array_length(public.list_employment_oauth_clients()),1,'direct session lists its approvals');
select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"jobs-client"}',true);
select throws_ok($$select public.inventory_search()$$,'42501','This OAuth client is not approved for Sabah One Inventory.',
  'Employment approval does not grant Inventory');
select throws_ok($$select public.get_helm_account_snapshot()$$,'42501','This session cannot read a Sabah One account snapshot.',
  'approved Employment client still cannot read the generic account');
select throws_ok($$select public.apply_helm_mutations('e0000000-0000-4000-8000-000000000099','[]')$$,
  '42501','OAuth clients cannot use this Sabah One interface.','approved Employment client cannot use generic writes');
select is((select count(*) from public.helm_records where collection='employment'),0::bigint,
  'Employment OAuth does not expose the singleton through table reads');
select lives_ok($$select public.employment_add_application('e0000000-0000-4000-8000-000000000003',
  '{"id":"micro1-job","company":"micro1","role":"AI projects","status":"applied","workType":"contract","remoteStatus":"needs_verification","url":"https://www.micro1.ai/jobs"}')$$,
  'approved agent creates an application in the actual app singleton');
select set_config('employment.test.add_result',public.employment_add_application('e0000000-0000-4000-8000-000000000003',
  '{"id":"micro1-job","company":"micro1","role":"AI projects","status":"applied","workType":"contract","remoteStatus":"needs_verification","url":"https://www.micro1.ai/jobs"}')::text,true);
select is(public.employment_add_application('e0000000-0000-4000-8000-000000000003',
  '{"id":"micro1-job","company":"micro1","role":"AI projects","status":"applied","workType":"contract","remoteStatus":"needs_verification","url":"https://www.micro1.ai/jobs"}'),
  current_setting('employment.test.add_result')::jsonb,'same request replay returns its exact receipt');
select throws_ok($$select public.employment_add_application('e0000000-0000-4000-8000-000000000003',
  '{"company":"Changed","role":"Changed"}')$$,'22023',
  'Employment idempotency key was reused with different arguments or client.','changed arguments cannot reuse a request ID');
select is(public.employment_get_application('preserved-job')->'application',current_setting('employment.test.preserved')::jsonb,
  'adding another job preserves the unrelated application byte for byte');
select is((public.employment_list_applications('micro1','applied',1,0,'contract','needs_verification')->>'total')::integer,1,
  'list combines query, status, work type and remote filters');
select is(public.employment_list_applications('',null,1,1)->'applications'->0->>'id','micro1-job',
  'list pagination retains singleton application order');
select throws_ok($$select public.employment_list_applications('',null,101)$$,'22023','Employment search bounds are invalid.',
  'list cannot exceed its page bound');
select is((public.employment_add_application('e0000000-0000-4000-8000-000000000004',
  '{"id":"new-duplicate-id","company":"micro1","role":"AI projects","url":"https://www.micro1.ai/jobs"}')->>'duplicate')::boolean,true,
  'same company role and source URL do not create a second application');
select lives_ok($$select public.employment_add_history('e0000000-0000-4000-8000-000000000005','micro1-job',
  '{"id":"email-1","kind":"contact","date":"2026-09-14","summary":"Profile under client review","evidenceUrl":"https://mail.google.com/mail/#all/email-1"}')$$,
  'agent appends dated recruiting evidence');
select is((public.employment_add_history('e0000000-0000-4000-8000-000000000006','micro1-job',
  '{"id":"retry-email-1","kind":"contact","date":"2026-09-14","summary":"Same email","evidenceUrl":"https://mail.google.com/mail/#all/email-1"}')->>'duplicate')::boolean,true,
  'same evidence URL with a fresh request and history ID is a no-op');
select is(jsonb_array_length(public.employment_get_application('micro1-job')->'application'->'history'),1,
  'duplicate email evidence appears only once');
select lives_ok($$select public.employment_update_application('e0000000-0000-4000-8000-000000000007','micro1-job',
  '{"nextAction":"Await final client decision","url":null}')$$,'agent updates fields and clears optional values');
select ok(not (public.employment_get_application('micro1-job')->'application' ? 'url'),
  'explicit null removes the optional URL');
select is(public.employment_get_application('micro1-job')->'application'->>'status','applied',
  'omitted status is preserved instead of inferring an offer');
select is(jsonb_array_length(public.employment_get_application('micro1-job')->'application'->'history'),1,
  'field patch preserves evidence history');
select throws_ok($$select public.employment_update_application('e0000000-0000-4000-8000-000000000008','micro1-job',
  '{"status":"offer"}','1900-01-01T00:00:00Z')$$,'40001','Employment application changed; reload before saving.',
  'stale per-application edits fail closed');
select throws_ok($$select public.employment_update_application('e0000000-0000-4000-8000-000000000009','micro1-job',
  '{"history":[]}')$$,'22023','Employment field history cannot be patched.',
  'OAuth history cannot be replaced or erased');
select throws_ok($$select public.employment_update_application('e0000000-0000-4000-8000-000000000010','micro1-job',
  '{"status":null}')$$,'22023','Only optional Employment fields may be cleared.','required fields cannot be removed');
select throws_ok($$select public.employment_update_application('e0000000-0000-4000-8000-000000000011','micro1-job',
  '{"userId":"e2222222-2222-4222-8222-222222222222"}')$$,'22023','Unsupported Employment field: userId.',
  'unknown fields cannot change account ownership');
select throws_ok($$select public.employment_add_history('e0000000-0000-4000-8000-000000000012','micro1-job',
  '{"kind":"note","summary":"Bad date","date":"2026-02-30"}')$$,'22023',
  'Employment dates must be valid YYYY-MM-DD dates.','invalid real calendar dates are rejected');
select throws_ok($$select public.employment_add_history('e0000000-0000-4000-8000-000000000013','micro1-job',
  '{"kind":"note","summary":"Bad URL","evidenceUrl":"javascript:alert(1)"}')$$,'22023',
  'Employment links must use HTTP or HTTPS.','active content cannot be stored as an evidence URL');
select throws_ok($$select public.employment_add_application('e0000000-0000-4000-8000-000000000014',
  '{"company":null,"role":"Engineer"}')$$,'22023','Employment field company must be bounded text.',
  'JSON null does not bypass required text validation');

select set_config('request.jwt.claims','{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false,"client_id":"jobs-client"}',true);
select throws_ok($$select public.employment_list_applications()$$,'42501',
  'This OAuth client is not approved for Sabah One Employment.','approval cannot cross accounts');
select set_config('request.jwt.claims','{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.approve_employment_oauth_client('jobs-client','Other account agent')$$,
  'other account can approve its own client');
select set_config('request.jwt.claims','{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false,"client_id":"jobs-client"}',true);
select throws_ok($$select public.employment_get_application('micro1-job')$$,'P0002','Employment application was not found.',
  'same approved client cannot read another account application');
select throws_ok($$select public.employment_update_application('e0000000-0000-4000-8000-000000000015','micro1-job','{"status":"closed"}')$$,
  'P0002','Employment application was not found.','same approved client cannot edit another account application');

select set_config('employment.test.nested_result',public.employment_add_application('e0000000-0000-4000-8000-000000000020',
  '{"company":"Mercor","role":"Migration projects","history":[{"kind":"contact","summary":"Profile activated"}]}')::text,true);
select ok(length(current_setting('employment.test.nested_result')::jsonb -> 'application' -> 'history' -> 0 ->> 'id') > 0
  and current_setting('employment.test.nested_result')::jsonb -> 'application' -> 'history' -> 0 ->> 'details'='',
  'new nested history receives server-generated ID and default details');
select is(public.employment_add_application('e0000000-0000-4000-8000-000000000020',
  '{"company":"Mercor","role":"Migration projects","history":[{"kind":"contact","summary":"Profile activated"}]}'),
  current_setting('employment.test.nested_result')::jsonb,'nested generated IDs remain stable on exact request replay');

select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.employment_update_application('e0000000-0000-4000-8000-000000000016','micro1-job',
  '{"notes":"Edited in the browser","history":[{"id":"browser-note","kind":"note","summary":"Browser note","details":""}]}')$$,
  'direct app merges new history entries with latest server evidence');
select is(jsonb_array_length(public.employment_get_application('micro1-job')->'application'->'history'),2,
  'stale browser history does not erase agent evidence');
select is(public.employment_get_application('preserved-job')->'application',current_setting('employment.test.preserved')::jsonb,
  'all field and history edits preserved the unrelated application');
select lives_ok($$select public.approve_employment_oauth_client('second-client','Second client')$$,'another client can receive independent approval');
select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"second-client"}',true);
select throws_ok($$select public.employment_add_application('e0000000-0000-4000-8000-000000000003',
  '{"id":"micro1-job","company":"micro1","role":"AI projects","status":"applied","workType":"contract","remoteStatus":"needs_verification","url":"https://www.micro1.ai/jobs"}')$$,
  '22023','Employment idempotency key was reused with different arguments or client.','request receipts cannot cross OAuth clients');
select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"jobs-client"}',true);
select throws_ok($$select public.employment_remove_application('e0000000-0000-4000-8000-000000000017','micro1-job')$$,
  '22023','Employment removal requires explicit confirmation.','removal requires explicit confirmation');
select lives_ok($$select public.employment_remove_application('e0000000-0000-4000-8000-000000000018','micro1-job',true)$$,
  'confirmed removal deletes only the selected application');
select is(public.employment_list_applications()->>'total','1','unrelated application survives removal');
select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.revoke_employment_oauth_client('jobs-client')$$,'direct app revokes Employment approval');
select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"jobs-client"}',true);
select throws_ok($$select public.employment_list_applications()$$,'42501',
  'This OAuth client is not approved for Sabah One Employment.','revocation immediately denies reads');
select throws_ok($$select public.employment_remove_application('e0000000-0000-4000-8000-000000000018','micro1-job',true)$$,
  '42501','This OAuth client is not approved for Sabah One Employment.','revocation also denies previously successful request replay');

reset role;
select ok(exists(select 1 from public.helm_records where user_id='e1111111-1111-4111-8111-111111111111'
  and collection='employment' and record_id='singleton' and payload ->> 'seedVersion'='1'
  and jsonb_array_length(payload->'applications')=1 and revision=account_version),
  'writes preserve the singleton codec and advance record revisions with account versions');
select is((select count(*) from public.helm_mutation_receipts where user_id='e1111111-1111-4111-8111-111111111111'),0::bigint,
  'Employment semantic mutations never use generic account receipts');
select ok(exists(select 1 from public.helm_employment_mutation_receipts where user_id='e1111111-1111-4111-8111-111111111111' and result is not null),
  'successful mutations persist domain-owned receipts');
select * from finish();
rollback;
