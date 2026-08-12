begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(64);

select has_table('public', 'helm_inventory_oauth_clients', 'Inventory OAuth approvals table exists');
select has_table('public', 'helm_inventory_mutation_receipts', 'Inventory idempotency table exists');
select has_function('public', 'apply_helm_inventory_mutations', array['uuid', 'jsonb'], 'first-party Inventory mutation RPC exists');
select has_function('public', 'inventory_search', array['text', 'text', 'text', 'text', 'integer'], 'Inventory search RPC exists');
select has_function('public', 'inventory_check', array['text', 'numeric', 'text'], 'Inventory stock check RPC exists');
select has_function('public', 'inventory_resolve_project', array['text'], 'minimal project resolver exists');
select has_function('public', 'inventory_save_items', array['uuid', 'jsonb'], 'bounded item save RPC exists');
select has_function('public', 'inventory_save_need', array['uuid', 'jsonb'], 'bounded need save RPC exists');
select has_function('public', 'inventory_complete_need', array['uuid', 'text', 'text'], 'atomic acquisition RPC exists');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '88888888-8888-4888-8888-888888888888',
    'authenticated', 'authenticated', 'inventory-a@example.test', '', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '99999999-9999-4999-8999-999999999999',
    'authenticated', 'authenticated', 'inventory-b@example.test', '', now(), now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false}',
  true
);

select lives_ok(
  $$select public.apply_helm_inventory_mutations(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    '[{
      "op":"create","collection":"inventoryItems","recordId":"m3-inserts",
      "payload":{
        "id":"m3-inserts","name":"M3 heat-set inserts","category":"fastener",
        "subcategory":"screws_fasteners",
        "imageUrl":"https://m.media-amazon.com/images/I/example.jpg",
        "trackingMode":"counted","quantity":10,"unit":"pcs","lowStockThreshold":5,
        "dimensions":{"length":20,"width":10,"unit":"mm"},
        "specifications":{"thread":"M3"},"condition":"new","tags":["3d-printing"],
        "notes":"Brass","projectCatalogKeys":["catalog:magnus"],
        "lastVerifiedAt":"2026-08-03T00:00:00.000Z",
        "createdAt":"2026-08-03T00:00:00.000Z","updatedAt":"2026-08-03T00:00:00.000Z"
      }
    }]'::jsonb
  )$$,
  'first-party app can create a validated Inventory item'
);

select is(
  (select payload ->> 'subcategory' from public.helm_records
    where collection = 'inventoryItems' and record_id = 'm3-inserts'),
  'screws_fasteners',
  'a practical Inventory subcategory is persisted'
);

select is(
  (select payload -> 'dimensions' from public.helm_records
    where collection = 'inventoryItems' and record_id = 'm3-inserts'),
  '{"length":20,"width":10,"unit":"mm"}'::jsonb,
  'partial Inventory dimensions are persisted'
);

select throws_ok(
  $$select public.apply_helm_inventory_mutations(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee14',
    '[{"op":"patch","collection":"inventoryItems","recordId":"m3-inserts","set":{"subcategory":"hand_tools"}}]'::jsonb
  )$$,
  '22023',
  'Inventory subcategory does not match its category.',
  'a mismatched Inventory subcategory is rejected'
);

select throws_ok(
  $$select public.apply_helm_inventory_mutations(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee15',
    '[{"op":"patch","collection":"inventoryItems","recordId":"m3-inserts","set":{"imageUrl":"http://example.test/item.jpg"}}]'::jsonb
  )$$,
  '22023',
  'Inventory image URL must be a valid HTTPS address.',
  'an insecure Inventory image URL is rejected'
);

select throws_ok(
  $$select public.apply_helm_inventory_mutations(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee51',
    '[{"op":"patch","collection":"inventoryItems","recordId":"m3-inserts","set":{"dimensions":{"unit":"mm"}}}]'::jsonb
  )$$,
  '22023',
  'Inventory dimensions require at least one positive axis.',
  'dimensions require at least one positive axis'
);

select throws_ok(
  $$select public.apply_helm_inventory_mutations(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    '[{
      "op":"patch","collection":"inventoryItems","recordId":"m3-inserts",
      "set":{"quantity":-1}
    }]'::jsonb
  )$$,
  '22023',
  'Inventory item quantity must be between 0 and 1000000000.',
  'negative stock is rejected'
);

select is(
  (select (payload ->> 'quantity')::numeric from public.helm_records
    where collection = 'inventoryItems' and record_id = 'm3-inserts'),
  10::numeric,
  'an invalid stock mutation rolls back'
);

select lives_ok(
  $$select public.inventory_save_need(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
    '{
      "id":"need-m3","name":"M3 heat-set inserts","category":"fastener",
      "subcategory":"screws_fasteners",
      "imageUrl":"https://m.media-amazon.com/images/I/example.jpg",
      "linkedItemId":"m3-inserts",
      "projectCatalogKey":"catalog:magnus","requiredQuantity":5,"unit":"pcs",
      "dimensions":{"length":20,"width":10,"unit":"mm"},
      "specifications":{"thread":"M3"},"priority":"high","status":"needed",
      "notes":"For the next tray","createdAt":"2026-08-03T00:00:00.000Z",
      "updatedAt":"2026-08-03T00:00:00.000Z"
    }'::jsonb
  )$$,
  'one bounded Inventory need can be saved'
);

select throws_ok(
  $$select public.inventory_save_need(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee16',
    '{
      "id":"need-bad-image","name":"Unsafe image","requiredQuantity":1,"unit":"pcs",
      "specifications":{},"priority":"normal","status":"needed","notes":"",
      "imageUrl":"https://user:secret@example.test/item.jpg",
      "createdAt":"2026-08-03T00:00:00.000Z","updatedAt":"2026-08-03T00:00:00.000Z"
    }'::jsonb
  )$$,
  '22023',
  'Inventory image URL must be a valid HTTPS address.',
  'credential-bearing Inventory image URLs are rejected'
);

select lives_ok(
  $$select public.inventory_complete_need(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'need-m3', null
  )$$,
  'acquisition updates stock and need atomically'
);

select is(
  (select (payload ->> 'quantity')::numeric from public.helm_records
    where collection = 'inventoryItems' and record_id = 'm3-inserts'),
  15::numeric,
  'acquisition adds the required quantity'
);

select is(
  (select payload -> 'dimensions' from public.helm_records
    where collection = 'inventoryItems' and record_id = 'm3-inserts'),
  '{"length":20,"width":10,"unit":"mm"}'::jsonb,
  'linked-stock acquisition preserves owned dimensions'
);

select is(
  (select payload ->> 'status' from public.helm_records
    where collection = 'inventoryNeeds' and record_id = 'need-m3'),
  'acquired',
  'acquisition closes the need'
);

select lives_ok(
  $$select public.inventory_complete_need(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'need-m3', null
  )$$,
  'replaying the acquisition request is idempotent'
);

select is(
  (select (payload ->> 'quantity')::numeric from public.helm_records
    where collection = 'inventoryItems' and record_id = 'm3-inserts'),
  15::numeric,
  'an idempotent acquisition replay does not double stock'
);

select lives_ok(
  $$select public.inventory_save_need(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee17',
    '{
      "id":"need-cabinet-jacks","name":"Cabinet installation arm jacks",
      "category":"tool","subcategory":"workshop_equipment",
      "imageUrl":"https://m.media-amazon.com/images/I/jacks.jpg",
      "requiredQuantity":2,"unit":"pcs","dimensions":{"height":75,"unit":"cm"},"specifications":{},
      "priority":"normal","status":"needed","notes":"",
      "createdAt":"2026-08-03T00:00:00.000Z","updatedAt":"2026-08-03T00:00:00.000Z"
    }'::jsonb
  )$$,
  'an unlinked need can retain its practical category and product image'
);

select lives_ok(
  $$select public.inventory_complete_need(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee18',
    'need-cabinet-jacks',
    'cabinet-jacks'
  )$$,
  'an unlinked categorized need can be acquired atomically'
);

select is(
  (select jsonb_build_object(
    'category', payload ->> 'category',
    'subcategory', payload ->> 'subcategory',
    'imageUrl', payload ->> 'imageUrl',
    'dimensions', payload -> 'dimensions'
  ) from public.helm_records
    where collection = 'inventoryItems' and record_id = 'cabinet-jacks'),
    '{
    "category":"tool",
    "subcategory":"workshop_equipment",
    "imageUrl":"https://m.media-amazon.com/images/I/jacks.jpg",
    "dimensions":{"height":75,"unit":"cm"}
  }'::jsonb,
  'acquisition carries need category and image into the owned catalogue'
);

select lives_ok(
  $$select public.apply_helm_mutations(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
    '[
      {"op":"create","collection":"projects","recordId":"magnus","payload":{"id":"magnus","catalogKey":"catalog:magnus","name":"MAGNUS","tags":["hardware","3d-printing"]}},
      {"op":"create","collection":"tasks","recordId":"private-task","payload":{"id":"private-task","title":"Private"}}
    ]'::jsonb
  )$$,
  'first-party app can still use non-Inventory account records'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (select count(*)::integer from public.helm_records),
  0,
  'another account cannot read the owner Inventory records'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false,"client_id":"codex-inventory"}',
  true
);
select throws_ok(
  $$select public.inventory_search('M3', null, null, null, 20)$$,
  '42501',
  'This OAuth client is not approved for Sabah One Inventory.',
  'an unapproved OAuth client fails closed'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false}',
  true
);
select lives_ok(
  $$select public.approve_inventory_oauth_client('codex-inventory', 'Sabah One Inventory')$$,
  'the first-party account can approve one OAuth client'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false,"client_id":"codex-inventory"}',
  true
);
select lives_ok(
  $$select public.inventory_search('M3', null, null, null, 20)$$,
  'an approved OAuth client can search Inventory'
);

select throws_ok(
  $$select public.inventory_search('', null, null, null, null)$$,
  '22023',
  'Inventory search bounds are invalid.',
  'a null search limit cannot remove the database cap'
);

select throws_ok(
  $$select public.inventory_search('', ' untrimmed ', null, null, 20)$$,
  '22023',
  'Inventory search bounds are invalid.',
  'project search filters must be bounded and trimmed'
);

select throws_ok(
  $$select public.inventory_search('', null, 'not-a-category', null, 20)$$,
  '22023',
  'Inventory search bounds are invalid.',
  'unknown search categories are rejected by the database'
);

select throws_ok(
  $$select public.inventory_check('M3 heat-set inserts', null, 'pcs')$$,
  '22023',
  'Inventory check input is invalid.',
  'a stock check requires a bounded quantity'
);

select throws_ok(
  $$select public.inventory_archive_item(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee13', ' untrimmed '
  )$$,
  '22023',
  'Inventory item id is invalid.',
  'archive targets must be bounded and trimmed'
);

select is(
  (select count(*)::integer from public.helm_records),
  4,
  'OAuth RLS exposes only Inventory records and hides projects and tasks'
);

select throws_ok(
  $$select public.get_helm_account_snapshot()$$,
  '42501',
  'This session cannot read a Sabah One account snapshot.',
  'OAuth clients cannot read generic account snapshots'
);
select throws_ok(
  $$select public.apply_helm_mutations(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6',
    '[{"op":"create","collection":"tasks","recordId":"oauth-task","payload":{"id":"oauth-task"}}]'::jsonb
  )$$,
  '42501',
  'OAuth clients cannot use this Sabah One interface.',
  'OAuth clients cannot use generic mutations'
);
select throws_ok(
  $$select public.list_helm_secrets()$$,
  '42501',
  'OAuth clients cannot use this Sabah One interface.',
  'OAuth clients cannot list secret metadata'
);
select throws_ok(
  $$select public.reveal_helm_secret('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  '42501',
  'OAuth clients cannot use this Sabah One interface.',
  'OAuth clients cannot reveal secrets'
);
select throws_ok(
  $$select public.save_helm_secret(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7', null, 'Denied', 'other', null,
    '{}'::text[], 'never', null, null, null, null
  )$$,
  '42501',
  'OAuth clients cannot use this Sabah One interface.',
  'OAuth clients cannot save secrets'
);
select throws_ok(
  $$select public.set_helm_secret_archived(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true
  )$$,
  '42501',
  'OAuth clients cannot use this Sabah One interface.',
  'OAuth clients cannot archive secrets'
);

select is(
  (select (public.inventory_resolve_project('MAGNUS') -> 0) - 'summary' - 'localPath'),
  '{"id":"magnus","name":"MAGNUS","catalogKey":"catalog:magnus"}'::jsonb,
  'project resolution returns only id, name, and catalogue key'
);

select is(
  public.inventory_resolve_project('3d-printing'),
  '[{"id":"magnus","name":"MAGNUS","catalogKey":"catalog:magnus"}]'::jsonb,
  'project resolution accepts an exact project tag'
);

select is(
  public.inventory_resolve_project('3D printing'),
  '[{"id":"magnus","name":"MAGNUS","catalogKey":"catalog:magnus"}]'::jsonb,
  'project tag resolution normalizes separators and case'
);

select throws_ok(
  $$select public.inventory_resolve_project('---')$$,
  '22023',
  'Project query is invalid.',
  'project tag resolution rejects a query with no searchable characters'
);

select lives_ok(
  $$select public.inventory_save_items(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9',
    '[{
      "id":"calipers","name":"Digital calipers","category":"tool",
      "trackingMode":"durable","quantity":1,"unit":"item",
      "dimensions":{"length":150,"width":30,"unit":"mm"},
      "specifications":{},"condition":"good","location":"Workshop drawer",
      "tags":["measurement"],"notes":"","projectCatalogKeys":[],
      "lastVerifiedAt":"2026-08-03T00:00:00.000Z",
      "createdAt":"2026-08-03T00:00:00.000Z","updatedAt":"2026-08-03T00:00:00.000Z"
    }]'::jsonb
  )$$,
  'approved OAuth client can save explicitly requested items'
);

select is(
  (select user_id from public.helm_records where collection = 'inventoryItems' and record_id = 'calipers'),
  '88888888-8888-4888-8888-888888888888'::uuid,
  'OAuth Inventory writes derive ownership from auth.uid()'
);

select lives_ok(
  $$select public.inventory_save_items(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee19',
    '[{"id":"calipers","dimensions":{"height":45,"unit":"cm"}}]'::jsonb
  )$$,
  'an explicit item id can safely enrich an existing Inventory record'
);

select is(
  (select jsonb_build_object(
    'dimensions', payload -> 'dimensions',
    'location', payload ->> 'location',
    'specifications', payload -> 'specifications'
  ) from public.helm_records
    where collection = 'inventoryItems' and record_id = 'calipers'),
  '{"dimensions":{"height":45,"unit":"cm"},"location":"Workshop drawer","specifications":{}}'::jsonb,
  'item enrichment preserves unspecified existing data'
);

select lives_ok(
  $$select public.inventory_save_items(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee19',
    '[{"id":"calipers","dimensions":{"height":45,"unit":"cm"}}]'::jsonb
  )$$,
  'replaying an item enrichment request is idempotent'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated","is_anonymous":false}',
  true
);
select lives_ok(
  $$select public.inventory_save_items(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee20',
    '[{
      "id":"calipers","name":"Account B calipers","category":"tool",
      "trackingMode":"durable","quantity":1,"unit":"item","specifications":{},
      "condition":"good","tags":[],"notes":"","projectCatalogKeys":[],
      "lastVerifiedAt":"2026-08-03T00:00:00.000Z",
      "createdAt":"2026-08-03T00:00:00.000Z","updatedAt":"2026-08-03T00:00:00.000Z"
    }]'::jsonb
  )$$,
  'another account cannot update the first account item'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  (select payload ->> 'name' from public.helm_records
    where user_id = '88888888-8888-4888-8888-888888888888'
      and collection = 'inventoryItems' and record_id = 'calipers'),
  'Digital calipers',
  'cross-account item enrichment leaves the owner record unchanged'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false}',
  true
);
select lives_ok(
  $$select public.approve_inventory_oauth_client('codex-inventory', 'Sabah One Inventory')$$,
  'the first-party account can re-approve the test client'
);
select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false,"client_id":"codex-inventory"}',
  true
);

select throws_ok(
  $$select public.inventory_save_items(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10',
    '[{
      "id":"smuggled","name":"Smuggled","category":"other","trackingMode":"counted",
      "quantity":1,"unit":"pcs","specifications":{},"condition":"unknown","tags":[],
      "notes":"","projectCatalogKeys":[],"lastVerifiedAt":"2026-08-03T00:00:00.000Z",
      "createdAt":"2026-08-03T00:00:00.000Z","updatedAt":"2026-08-03T00:00:00.000Z",
      "secret":"forbidden"
    }]'::jsonb
  )$$,
  '22023',
  null,
  'unknown Inventory fields are rejected'
);

select lives_ok(
  $$select public.inventory_archive_item(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee11', 'calipers'
  )$$,
  'approved OAuth client can archive one explicitly targeted item'
);

select ok(
  (select payload ? 'archivedAt' from public.helm_records
    where collection = 'inventoryItems' and record_id = 'calipers'),
  'archiving records a reversible lifecycle timestamp'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false}',
  true
);
select lives_ok(
  $$select public.revoke_inventory_oauth_client('codex-inventory')$$,
  'the first-party account can revoke a client'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false,"client_id":"codex-inventory"}',
  true
);
select throws_ok(
  $$select public.inventory_search('', null, null, null, 20)$$,
  '42501',
  'This OAuth client is not approved for Sabah One Inventory.',
  'revocation takes effect on the next Inventory request'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated","is_anonymous":false}',
  true
);
select throws_ok(
  $$select public.apply_helm_mutations(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee12',
    '[{"op":"create","collection":"captureItems","recordId":"legacy","payload":{"id":"legacy"}}]'::jsonb
  )$$,
  '42501',
  'The legacy Capture Inbox collection is retired.',
  'retired Capture records cannot be recreated'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"sub":null,"role":"anon","is_anonymous":true}', true);
select throws_ok(
  $$select public.inventory_search('', null, null, null, 20)$$,
  '42501',
  'permission denied for function inventory_search',
  'anonymous sessions cannot execute Inventory RPCs'
);

reset role;
select * from finish();
rollback;
