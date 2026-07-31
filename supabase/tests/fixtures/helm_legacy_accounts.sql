insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'alisab@example.test', '', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'xaoilin@example.test', '', now(), now()
  );

insert into public.kv_store (user_id, namespace, key, value, updated_at)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'integrations',
    '[
      {"id":"int-google","name":"Google Calendar","provider":"google","status":"connected"},
      {"id":"int-github","name":"GitHub","provider":"github","status":"connected"}
    ]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'settings',
    '{
      "0":{"id":"int-google","name":"Google Calendar"},
      "1":{"id":"int-github","name":"GitHub"},
      "theme":"dark",
      "telemetry":false,
      "deepgramApiKey":"must-not-migrate",
      "supabaseAnonKey":"must-not-migrate"
    }'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'projects',
    (
      select jsonb_agg(jsonb_build_object(
        'id', 'project-' || lpad(project_number::text, 2, '0'),
        'name', 'Project ' || project_number,
        'isPinned', project_number <= 6,
        'status', case when project_number > 19 then 'archived' else 'active' end
      ) order by project_number)
      from generate_series(1, 21) as project_number
    ),
    '2026-07-31T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'knowledgeEntries',
    '[
      {"id":"knowledge-valid","title":"Valid"},
      {"title":"Missing id"},
      {"id":"knowledge-duplicate","title":"Duplicate A"},
      {"id":"knowledge-duplicate","title":"Duplicate B"}
    ]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'tasks',
    '[{"id":"alisa-task","title":"Alisa task","completed":false}]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'helm',
    'financeAccounts',
    '[{"id":"x-account","name":"X account"}]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'helm',
    'transactions',
    '[{"id":"x-transaction-1","amount":100},{"id":"x-transaction-2","amount":200}]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'helm',
    'tasks',
    '[{"id":"x-task","title":"X task","completed":false}]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'helm',
    'conversations',
    '[{"id":"x-conversation","title":"X conversation","messages":[]}]'::jsonb,
    '2026-07-31T12:00:00Z'
  );

create table public.helm_test_legacy_snapshot (
  user_id uuid primary key,
  snapshot_hash text not null
);

insert into public.helm_test_legacy_snapshot (user_id, snapshot_hash)
select
  user_id::uuid,
  md5(jsonb_agg(
    jsonb_build_object('namespace', namespace, 'key', key, 'value', value, 'updatedAt', updated_at)
    order by namespace, key
  )::text)
from public.kv_store
group by user_id;

create table public.helm_test_store_expectation (
  user_id uuid not null,
  collection text not null,
  valid_count integer not null,
  payload_hash text not null,
  primary key (user_id, collection)
);

insert into public.helm_test_store_expectation (user_id, collection, valid_count, payload_hash)
select
  kv.user_id::uuid,
  kv.key,
  count(*)::integer,
  md5(jsonb_agg(item.value order by item.ordinal)::text)
from public.kv_store kv
cross join lateral jsonb_array_elements(kv.value) with ordinality as item(value, ordinal)
where kv.namespace = 'helm'
  and kv.key <> 'knowledgeEntries'
  and jsonb_typeof(kv.value) = 'array'
group by kv.user_id, kv.key;

-- A pre-account browser snapshot has no authenticated owner. It remains
-- byte-for-byte in kv_store but must never enter account-owned HELM tables.
insert into public.kv_store (user_id, namespace, key, value, updated_at)
values (
  'legacy-unowned-browser',
  'helm',
  'tasks',
  '[{"id":"unowned-task","title":"Must remain unattached"}]'::jsonb,
  '2026-03-31T01:01:20Z'
);
