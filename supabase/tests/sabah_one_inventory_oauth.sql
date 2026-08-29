begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

select has_table(
  'public', 'helm_inventory_oauth_clients',
  'Inventory OAuth approvals have a private table'
);
select has_table(
  'public', 'helm_inventory_mutation_receipts',
  'Inventory mutations have private receipts'
);
select has_function(
  'public', 'apply_helm_inventory_mutations', array['uuid', 'jsonb'],
  'bounded Inventory mutation RPC exists'
);
select has_function(
  'public', 'inventory_search', array['text', 'text', 'text', 'text', 'integer'],
  'bounded Inventory search RPC exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.helm_inventory_oauth_clients'::regclass),
  'Inventory OAuth approvals have row-level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.helm_inventory_mutation_receipts'::regclass),
  'Inventory receipts have row-level security enabled'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.inventory_search(text, text, text, text, integer)',
    'execute'
  ),
  'authenticated callers can use the bounded Inventory interface'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.inventory_search(text, text, text, text, integer)',
    'execute'
  ),
  'anonymous callers cannot execute the Inventory interface'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);
select ok(
  (
    public.inventory_search('', null, null, null, 20) ? 'items'
    and public.inventory_search('', null, null, null, 20) ? 'needs'
    and jsonb_array_length(public.inventory_search('', null, null, null, 20) -> 'items') = 0
    and jsonb_array_length(public.inventory_search('', null, null, null, 20) -> 'needs') = 0
  ),
  'a first-party session receives only the bounded Inventory result shape'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false,"client_id":"unapproved-client"}',
  true
);
select throws_ok(
  $$select public.get_helm_account_snapshot()$$,
  '42501',
  'This session cannot read a Sabah One account snapshot.',
  'an OAuth client cannot escape into the generic account snapshot'
);
select throws_ok(
  $$select public.list_helm_secrets()$$,
  '42501',
  'OAuth clients cannot use this Sabah One interface.',
  'an OAuth client cannot escape into Secrets'
);
select throws_ok(
  $$select public.apply_helm_mutations(
    'cccccccc-cccc-4ccc-8ccc-cccccccc0001',
    '[{"op":"create","collection":"tasks","recordId":"blocked","payload":{"id":"blocked"}}]'::jsonb
  )$$,
  '42501',
  'OAuth clients cannot use this Sabah One interface.',
  'an OAuth client cannot use generic account mutations'
);
select throws_ok(
  $$select public.inventory_search('', null, null, null, 20)$$,
  '42501',
  'This OAuth client is not approved for Sabah One Inventory.',
  'an unapproved OAuth client fails closed on Inventory'
);
select throws_ok(
  $$select public.approve_inventory_oauth_client('unapproved-client', 'Should fail')$$,
  '42501',
  'OAuth clients cannot use this Sabah One interface.',
  'an OAuth client cannot grant itself Inventory approval'
);

reset role;
set local role anon;
select set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"anon","is_anonymous":true}',
  true
);
select throws_ok(
  $$select public.inventory_search('', null, null, null, 20)$$,
  '42501',
  'permission denied for function inventory_search',
  'anonymous sessions cannot execute Inventory RPCs'
);

reset role;
select * from finish();
rollback;
