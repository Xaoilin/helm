begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(84);

-- The generic record store, the legacy per-domain agent RPCs and their receipts are gone.
select is(to_regprocedure('public.get_helm_account_snapshot()'), null, 'public.get_helm_account_snapshot() is dropped');
select is(to_regprocedure('public.get_helm_account_snapshot_for_collections(text[])'), null, 'public.get_helm_account_snapshot_for_collections(text[]) is dropped');
select is(to_regprocedure('public.get_helm_changed_collections(bigint)'), null, 'public.get_helm_changed_collections(bigint) is dropped');
select is(to_regprocedure('public.apply_helm_mutations(uuid,jsonb)'), null, 'public.apply_helm_mutations(uuid,jsonb) is dropped');
select is(to_regprocedure('helm_private.apply_helm_mutations_direct(uuid,jsonb)'), null, 'helm_private.apply_helm_mutations_direct(uuid,jsonb) is dropped');
select is(to_regprocedure('helm_private.get_helm_account_snapshot_direct()'), null, 'helm_private.get_helm_account_snapshot_direct() is dropped');
select is(to_regprocedure('public.apply_helm_inventory_mutations(uuid,jsonb)'), null, 'public.apply_helm_inventory_mutations(uuid,jsonb) is dropped');
select is(to_regprocedure('public.inventory_search(text,text,text,text,integer)'), null, 'public.inventory_search(text,text,text,text,integer) is dropped');
select is(to_regprocedure('public.inventory_check(text,numeric,text)'), null, 'public.inventory_check(text,numeric,text) is dropped');
select is(to_regprocedure('public.inventory_save_items(uuid,jsonb)'), null, 'public.inventory_save_items(uuid,jsonb) is dropped');
select is(to_regprocedure('public.inventory_save_need(uuid,jsonb)'), null, 'public.inventory_save_need(uuid,jsonb) is dropped');
select is(to_regprocedure('public.inventory_complete_need(uuid,text,text)'), null, 'public.inventory_complete_need(uuid,text,text) is dropped');
select is(to_regprocedure('public.inventory_archive_item(uuid,text)'), null, 'public.inventory_archive_item(uuid,text) is dropped');
select is(to_regprocedure('helm_private.apply_inventory_mutations(uuid,uuid,text,jsonb)'), null, 'helm_private.apply_inventory_mutations(uuid,uuid,text,jsonb) is dropped');
select is(to_regprocedure('helm_private.require_inventory_actor()'), null, 'helm_private.require_inventory_actor() is dropped');
select is(to_regprocedure('helm_private.copy_inventory_need_visuals_to_acquired_item()'), null, 'helm_private.copy_inventory_need_visuals_to_acquired_item() is dropped');
select is(to_regprocedure('helm_private.validate_sabah_one_record()'), null, 'helm_private.validate_sabah_one_record() is dropped');
select is(to_regprocedure('helm_private.validate_inventory_payload(text,text,jsonb)'), null, 'helm_private.validate_inventory_payload(text,text,jsonb) is dropped');
select is(to_regprocedure('helm_private.validate_inventory_text_array(jsonb,text,integer,integer)'), null, 'helm_private.validate_inventory_text_array(jsonb,text,integer,integer) is dropped');
select is(to_regprocedure('helm_private.validate_inventory_specifications(jsonb)'), null, 'helm_private.validate_inventory_specifications(jsonb) is dropped');
select is(to_regprocedure('helm_private.validate_inventory_dimensions(jsonb)'), null, 'helm_private.validate_inventory_dimensions(jsonb) is dropped');
select is(to_regprocedure('helm_private.inventory_client_is_approved(uuid,text)'), null, 'helm_private.inventory_client_is_approved(uuid,text) is dropped');
select is(to_regprocedure('public.employment_list_applications(text,text,integer,integer,text,text)'), null, 'public.employment_list_applications(text,text,integer,integer,text,text) is dropped');
select is(to_regprocedure('public.employment_get_application(text)'), null, 'public.employment_get_application(text) is dropped');
select is(to_regprocedure('public.employment_add_application(uuid,jsonb)'), null, 'public.employment_add_application(uuid,jsonb) is dropped');
select is(to_regprocedure('public.employment_update_application(uuid,text,jsonb,text)'), null, 'public.employment_update_application(uuid,text,jsonb,text) is dropped');
select is(to_regprocedure('public.employment_add_history(uuid,text,jsonb)'), null, 'public.employment_add_history(uuid,text,jsonb) is dropped');
select is(to_regprocedure('public.employment_remove_application(uuid,text,boolean,text)'), null, 'public.employment_remove_application(uuid,text,boolean,text) is dropped');
select is(to_regprocedure('helm_private.mutate_employment(uuid,text,text,jsonb,text)'), null, 'helm_private.mutate_employment(uuid,text,text,jsonb,text) is dropped');
select is(to_regprocedure('helm_private.validate_employment_payload(jsonb,boolean)'), null, 'helm_private.validate_employment_payload(jsonb,boolean) is dropped');
select is(to_regprocedure('helm_private.require_employment_actor()'), null, 'helm_private.require_employment_actor() is dropped');
select is(to_regprocedure('public.finance_get_review()'), null, 'public.finance_get_review() is dropped');
select is(to_regprocedure('public.finance_save_review(uuid,jsonb,text)'), null, 'public.finance_save_review(uuid,jsonb,text) is dropped');
select is(to_regprocedure('helm_private.validate_finance_payload(jsonb,text)'), null, 'helm_private.validate_finance_payload(jsonb,text) is dropped');
select is(to_regprocedure('helm_private.require_finance_actor()'), null, 'helm_private.require_finance_actor() is dropped');
select is(to_regprocedure('public.equity_list_positions(text,integer,integer)'), null, 'public.equity_list_positions(text,integer,integer) is dropped');
select is(to_regprocedure('public.equity_get_position(text)'), null, 'public.equity_get_position(text) is dropped');
select is(to_regprocedure('public.equity_add_position(uuid,jsonb)'), null, 'public.equity_add_position(uuid,jsonb) is dropped');
select is(to_regprocedure('public.equity_update_position(uuid,text,jsonb,text)'), null, 'public.equity_update_position(uuid,text,jsonb,text) is dropped');
select is(to_regprocedure('public.equity_remove_position(uuid,text,boolean,text)'), null, 'public.equity_remove_position(uuid,text,boolean,text) is dropped');
select is(to_regprocedure('helm_private.mutate_equity(uuid,text,text,jsonb,text)'), null, 'helm_private.mutate_equity(uuid,text,text,jsonb,text) is dropped');
select is(to_regprocedure('helm_private.validate_equity_payload(jsonb,text)'), null, 'helm_private.validate_equity_payload(jsonb,text) is dropped');
select is(to_regprocedure('helm_private.require_equity_actor()'), null, 'helm_private.require_equity_actor() is dropped');
select hasnt_table('public', 'helm_mutation_receipts', 'public.helm_mutation_receipts is dropped');
select hasnt_table('public', 'helm_legacy_quarantine', 'public.helm_legacy_quarantine is dropped');
select hasnt_table('public', 'helm_inventory_mutation_receipts', 'public.helm_inventory_mutation_receipts is dropped');
select hasnt_table('public', 'helm_employment_mutation_receipts', 'public.helm_employment_mutation_receipts is dropped');
select hasnt_table('public', 'helm_finance_mutation_receipts', 'public.helm_finance_mutation_receipts is dropped');
select hasnt_table('public', 'helm_equity_mutation_receipts', 'public.helm_equity_mutation_receipts is dropped');

-- Nothing broadcasts over Realtime any more.
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'realtime' and tablename = 'messages' and policyname = 'HELM account broadcasts are private'),
  0,
  'the private account Broadcast policy is dropped'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'helm_private') and p.prosrc like '%realtime.send%'),
  0,
  'no Sabah One function sends a Realtime Broadcast'
);

-- Vault secrets, agent OAuth approvals and the import-only records are kept.
select isnt(to_regprocedure('public.list_helm_secrets()'), null, 'public.list_helm_secrets() is kept');
select isnt(to_regprocedure('public.reveal_helm_secret(uuid)'), null, 'public.reveal_helm_secret(uuid) is kept');
select isnt(to_regprocedure('public.save_helm_secret(uuid,uuid,text,text,text,text[],text,text,text,text,text)'), null, 'public.save_helm_secret(uuid,uuid,text,text,text,text[],text,text,text,text,text) is kept');
select isnt(to_regprocedure('public.set_helm_secret_archived(uuid,uuid,boolean)'), null, 'public.set_helm_secret_archived(uuid,uuid,boolean) is kept');
select isnt(to_regprocedure('helm_private.list_helm_secrets_direct()'), null, 'helm_private.list_helm_secrets_direct() is kept');
select isnt(to_regprocedure('helm_private.reveal_helm_secret_direct(uuid)'), null, 'helm_private.reveal_helm_secret_direct(uuid) is kept');
select isnt(to_regprocedure('helm_private.save_helm_secret_direct(uuid,uuid,text,text,text,text[],text,text,text,text,text)'), null, 'helm_private.save_helm_secret_direct(uuid,uuid,text,text,text,text[],text,text,text,text,text) is kept');
select isnt(to_regprocedure('helm_private.set_helm_secret_archived_direct(uuid,uuid,boolean)'), null, 'helm_private.set_helm_secret_archived_direct(uuid,uuid,boolean) is kept');
select isnt(to_regprocedure('helm_private.delete_secret_vault_value()'), null, 'helm_private.delete_secret_vault_value() is kept');
select isnt(to_regprocedure('helm_private.assert_direct_sabah_one_session()'), null, 'helm_private.assert_direct_sabah_one_session() is kept');
select isnt(to_regprocedure('helm_private.initialize_account_state()'), null, 'helm_private.initialize_account_state() is kept');
select isnt(to_regprocedure('public.list_inventory_oauth_clients()'), null, 'public.list_inventory_oauth_clients() is kept');
select isnt(to_regprocedure('public.approve_inventory_oauth_client(text,text)'), null, 'public.approve_inventory_oauth_client(text,text) is kept');
select isnt(to_regprocedure('public.revoke_inventory_oauth_client(text)'), null, 'public.revoke_inventory_oauth_client(text) is kept');
select isnt(to_regprocedure('public.list_employment_oauth_clients()'), null, 'public.list_employment_oauth_clients() is kept');
select isnt(to_regprocedure('public.approve_employment_oauth_client(text,text)'), null, 'public.approve_employment_oauth_client(text,text) is kept');
select isnt(to_regprocedure('public.revoke_employment_oauth_client(text)'), null, 'public.revoke_employment_oauth_client(text) is kept');
select isnt(to_regprocedure('public.list_equity_oauth_clients()'), null, 'public.list_equity_oauth_clients() is kept');
select isnt(to_regprocedure('public.approve_equity_oauth_client(text,text)'), null, 'public.approve_equity_oauth_client(text,text) is kept');
select isnt(to_regprocedure('public.revoke_equity_oauth_client(text)'), null, 'public.revoke_equity_oauth_client(text) is kept');
select isnt(to_regprocedure('public.list_finance_oauth_clients()'), null, 'public.list_finance_oauth_clients() is kept');
select isnt(to_regprocedure('public.approve_finance_oauth_client(text,text)'), null, 'public.approve_finance_oauth_client(text,text) is kept');
select isnt(to_regprocedure('public.revoke_finance_oauth_client(text)'), null, 'public.revoke_finance_oauth_client(text) is kept');
select has_table('public', 'helm_records', 'public.helm_records is kept');
select has_table('public', 'helm_account_state', 'public.helm_account_state is kept');
select has_table('public', 'helm_secret_entries', 'public.helm_secret_entries is kept');
select has_table('public', 'helm_secret_mutation_receipts', 'public.helm_secret_mutation_receipts is kept');
select has_table('public', 'helm_inventory_oauth_clients', 'public.helm_inventory_oauth_clients is kept');
select has_table('public', 'helm_employment_oauth_clients', 'public.helm_employment_oauth_clients is kept');
select has_table('public', 'helm_equity_oauth_clients', 'public.helm_equity_oauth_clients is kept');
select has_table('public', 'helm_finance_oauth_clients', 'public.helm_finance_oauth_clients is kept');
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename = 'helm_records' and cmd = 'SELECT'
     and policyname = 'Sabah One records are first party'),
  1,
  'the remaining records are readable only by their first-party owner'
);
select is(
  (select count(*)::integer from pg_trigger
   where tgrelid = 'public.helm_records'::regclass and not tgisinternal),
  0,
  'no Inventory trigger remains on the import-only records'
);

select * from finish();
rollback;
