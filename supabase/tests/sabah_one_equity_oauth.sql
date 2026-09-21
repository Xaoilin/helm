begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','f1111111-1111-4111-8111-111111111111','authenticated','authenticated','equity-owner@example.test','',now(),now()),
  ('00000000-0000-0000-0000-000000000000','f2222222-2222-4222-8222-222222222222','authenticated','authenticated','equity-other@example.test','',now(),now());
select set_config('equity.test.draft', '{
  "id":"example-position","company":"Example Co","asOf":"2026-09-21","ownedShares":100,
  "stockPlan":{"summary":"","status":"undecided","waitingFor":"","nextAction":""},
  "optionPlan":{"summary":"Hold pending review","status":"agreed","waitingFor":"Verified opportunity","nextAction":"Review terms","reviewMonth":"2027-09"},
  "employmentNote":"Active employee",
  "grants":[{"id":"grant-a","grantDate":"2025-01-01","vested":10,"unvested":20,"strikeUsd":5,"originalExpiry":"2035-01-01","nextVest":{"date":"2026-11-15","alternateDate":"2026-11-14","quantity":5,"condition":"Subject to employment"}}],
  "actions":[{"id":"action-a","title":"Review terms","timing":"Before departure","done":false}],
  "details":[{"id":"detail-a","title":"Policy","body":"Verify actual grant terms."}],
  "sources":[{"id":"source-a","label":"Grant document","url":"https://example.com/grant","asOf":"2026-09-21"}],
  "scenario":{"pricesUsd":[4,10],"withholdingRate":0.4,"usdToGbp":0.75,"asOf":"2026-09-21","notes":"Illustrative before fees"}
}',true);

select ok((select relrowsecurity from pg_class where oid='public.helm_equity_oauth_clients'::regclass),'Equity approvals have RLS');
select ok((select relrowsecurity from pg_class where oid='public.helm_equity_mutation_receipts'::regclass),'Equity receipts have RLS');
select ok(not has_table_privilege('authenticated','public.helm_equity_oauth_clients','select'),'approval storage is private');
select ok(not has_table_privilege('authenticated','public.helm_equity_mutation_receipts','select'),'mutation receipts are private');
select ok(not has_function_privilege('authenticated','helm_private.mutate_equity(uuid,text,text,jsonb,text)','execute'),'private engine cannot be called by clients');
select ok(not has_function_privilege('anon','public.equity_list_positions(text,integer,integer)','execute'),'anonymous reads are denied');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select is(public.equity_list_positions()->'positions','[]'::jsonb,'new account starts empty');
select lives_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000001',current_setting('equity.test.draft')::jsonb)$$,'browser creates a complete private position with undecided stock plan');
select set_config('equity.test.original',(public.equity_get_position('example-position')->'position')::text,true);
select is((public.equity_get_position('example-position')->'position'->>'ownedShares')::integer,100,'owned shares persist separately');
select is((public.equity_get_position('example-position')->'position'->'grants'->0->>'vested')::integer,10,'unexercised options persist separately');
select is((public.equity_list_positions('Example',1,0)->>'total')::integer,1,'search is bounded and company-filtered');
select is(public.equity_list_positions('',1,1)->'positions','[]'::jsonb,'pagination returns bounded pages');
select throws_ok($$select public.equity_list_positions('',101)$$,'22023','Equity search bounds are invalid.','oversized page rejected');
select lives_ok($$select public.approve_inventory_oauth_client('other-domain-client','Other domain agent')$$,'Inventory approval is independent');
select lives_ok($$select public.approve_employment_oauth_client('other-domain-client','Other domain agent')$$,'Employment approval is independent');
select set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"other-domain-client"}',true);
select throws_ok($$select public.equity_list_positions()$$,'42501','This OAuth client is not approved for Sabah One Equity.','other domain approvals do not authorize Equity');
select throws_ok($$select public.approve_equity_oauth_client('other-domain-client','Self approval')$$,'42501','OAuth clients cannot use this Sabah One interface.','OAuth client cannot approve itself');

select set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select is(public.approve_equity_oauth_client('equity-client','Equity agent')->>'clientId','equity-client','browser grants domain approval');
select is(jsonb_array_length(public.list_equity_oauth_clients()),1,'browser can inspect own approvals');
select set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"equity-client"}',true);
select throws_ok($$select public.inventory_search()$$,'42501','This OAuth client is not approved for Sabah One Inventory.','Equity does not authorize Inventory');
select throws_ok($$select public.employment_list_applications()$$,'42501','This OAuth client is not approved for Sabah One Employment.','Equity does not authorize Employment');
select throws_ok($$select public.get_helm_account_snapshot()$$,'42501','This session cannot read a Sabah One account snapshot.','Equity agent cannot read entire account');
select throws_ok($$select public.apply_helm_mutations('f0000000-0000-4000-8000-000000000099','[]')$$,'42501','OAuth clients cannot use this Sabah One interface.','Equity agent cannot use generic writes');
select is((select count(*) from public.helm_records where collection='equityPositions'),0::bigint,'OAuth cannot directly read Equity rows');
select lives_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000002',current_setting('equity.test.draft')::jsonb || '{"id":"second-position","company":"Second Example"}')$$,'approved agent creates another private record');
select set_config('equity.test.receipt',public.equity_add_position('f0000000-0000-4000-8000-000000000002',current_setting('equity.test.draft')::jsonb || '{"id":"second-position","company":"Second Example"}')::text,true);
select is(public.equity_add_position('f0000000-0000-4000-8000-000000000002',current_setting('equity.test.draft')::jsonb || '{"id":"second-position","company":"Second Example"}'),current_setting('equity.test.receipt')::jsonb,'exact replay returns original receipt');
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000002',current_setting('equity.test.draft')::jsonb || '{"id":"changed"}')$$,'22023','Equity idempotency key was reused with different arguments or client.','changed input cannot reuse idempotency key');
select is(public.equity_get_position('example-position')->'position',current_setting('equity.test.original')::jsonb,'agent addition preserves existing browser position');
select lives_ok($$select public.equity_update_position('f0000000-0000-4000-8000-000000000003','example-position',(current_setting('equity.test.draft')::jsonb - 'id') || '{"ownedShares":101}',current_setting('equity.test.original')::jsonb->>'updatedAt')$$,'latest revision can be edited');
select throws_ok($$select public.equity_update_position('f0000000-0000-4000-8000-000000000004','example-position',current_setting('equity.test.draft')::jsonb - 'id',current_setting('equity.test.original')::jsonb->>'updatedAt')$$,'40001','Equity position changed; reload before saving.','stale full drafts cannot overwrite concurrent changes');
select set_config('equity.test.latest',(public.equity_get_position('example-position')->'position')::text,true);
select throws_ok($$select public.equity_update_position('f0000000-0000-4000-8000-000000000005','example-position',current_setting('equity.test.draft')::jsonb - 'id',null)$$,'22023','Equity mutation requires bounded input and the latest updatedAt for edits.','missing concurrency token rejected');
select throws_ok($$select public.equity_remove_position('f0000000-0000-4000-8000-000000000006','example-position',false,current_setting('equity.test.latest')::jsonb->>'updatedAt')$$,'22023','Equity removal requires explicit confirmation.','remove requires confirmation');
select throws_ok($$select public.equity_remove_position('f0000000-0000-4000-8000-000000000007','example-position',true,current_setting('equity.test.original')::jsonb->>'updatedAt')$$,'40001','Equity position changed; reload before saving.','stale removals cannot erase changed plans');

-- Direct SQL validation remains authoritative even if a caller bypasses MCP schemas.
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000010',current_setting('equity.test.draft')::jsonb || '{"id":"invalid","ownedShares":null}')$$,'22023','Equity ownedShares must be a bounded number.','null holdings rejected');
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000011',current_setting('equity.test.draft')::jsonb || '{"id":"invalid","ownedShares":0.5}')$$,'22023','Equity ownedShares must be a bounded number.','fractional shares rejected by current whole-share contract');
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000012',current_setting('equity.test.draft')::jsonb || '{"id":"invalid","asOf":"2026-02-30"}')$$,'22023','Equity dates must be valid YYYY-MM-DD dates.','impossible dates rejected');
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000013',current_setting('equity.test.draft')::jsonb || '{"id":"invalid","asOf":"0000-01-01"}')$$,'22023','Equity dates must be valid YYYY-MM-DD dates.','year zero rejected');
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000014',current_setting('equity.test.draft')::jsonb || '{"id":"invalid","userId":"other"}')$$,'22023','Unsupported Equity field: userId.','ownership cannot be injected');
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000015',jsonb_set(current_setting('equity.test.draft')::jsonb || '{"id":"invalid"}','{sources,0,url}','"javascript:alert(1)"'))$$,'22023','Equity sources require HTTP or HTTPS URLs without credentials.','active source URLs rejected');
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000016',jsonb_set(current_setting('equity.test.draft')::jsonb || '{"id":"invalid"}','{grants}',(current_setting('equity.test.draft')::jsonb->'grants') || (current_setting('equity.test.draft')::jsonb->'grants')))$$,'22023','Equity grants contains duplicate IDs.','duplicate grant identifiers rejected');

select set_config('request.jwt.claims','{"sub":"f2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false,"client_id":"equity-client"}',true);
select throws_ok($$select public.equity_list_positions()$$,'42501','This OAuth client is not approved for Sabah One Equity.','approvals never cross account boundaries');
select set_config('request.jwt.claims','{"sub":"f2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
select lives_ok($$select public.approve_equity_oauth_client('equity-client','Other account agent')$$,'second account can independently approve same client');
select set_config('request.jwt.claims','{"sub":"f2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false,"client_id":"equity-client"}',true);
select is(public.equity_list_positions()->'positions','[]'::jsonb,'second account cannot list first account holdings');
select throws_ok($$select public.equity_get_position('example-position')$$,'P0002','Equity position was not found.','same client cannot read another account position');
select throws_ok($$select public.equity_remove_position('f0000000-0000-4000-8000-000000000020','example-position',true,current_setting('equity.test.latest')::jsonb->>'updatedAt')$$,'P0002','Equity position was not found.','same client cannot delete another account position');

select set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
select is((select count(*) from public.helm_records where collection='equityPositions' and deleted_at is null),2::bigint,'browser reload can read both persisted positions');
select lives_ok($$select public.equity_remove_position('f0000000-0000-4000-8000-000000000021','example-position',true,current_setting('equity.test.latest')::jsonb->>'updatedAt')$$,'confirmed current browser removal succeeds');
select is((public.equity_list_positions()->>'total')::integer,1,'remove preserves unrelated position');
select lives_ok($$select public.revoke_equity_oauth_client('equity-client')$$,'browser revokes Equity independently');
select set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"equity-client"}',true);
select throws_ok($$select public.equity_add_position('f0000000-0000-4000-8000-000000000002',current_setting('equity.test.draft')::jsonb || '{"id":"second-position","company":"Second Example"}')$$,'42501','This OAuth client is not approved for Sabah One Equity.','revocation denies exact retries before receipt lookup');
select set_config('request.jwt.claims','{"sub":"f1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.equity_list_positions()$$,'42501','A signed-in Sabah One account is required.','anonymous authenticated sessions fail closed');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.equity_list_positions()$$,'42501','A signed-in Sabah One account is required.','missing identity fails closed');
select * from finish();
rollback;
