-- Deterministic pre-cutover accounts and rollback rows for migration tests.
-- These rows model only the legacy contracts consumed by the migrations.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-4111-8111-111111111111',
    'authenticated', 'authenticated', 'kan252-a@example.test', '',
    '2026-07-31T12:00:00Z', '2026-07-31T12:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-4222-8222-222222222222',
    'authenticated', 'authenticated', 'kan252-b@example.test', '',
    '2026-07-31T12:00:00Z', '2026-07-31T12:00:00Z'
  );

insert into public.kv_store (user_id, namespace, key, value, updated_at)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'settings',
    '{
      "theme":"dark",
      "telemetry":false,
      "deepgramApiKey":"legacy-device-secret",
      "supabaseAnonKey":"legacy-browser-key"
    }'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'projects',
    '[{
      "id":"a-project",
      "name":"Account A project",
      "catalogKey":"catalog:a-project",
      "isPinned":true,
      "localPath":"/private/account-a"
    }]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'tasks',
    '[{
      "id":"a-task",
      "title":"Account A task",
      "completed":false
    }]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'helm',
    'knowledgeEntries',
    '[
      {"id":"a-note","title":"Retained note"},
      {"title":"Missing stable id"},
      {"id":"repeat","title":"First duplicate"},
      {"id":"repeat","title":"Second duplicate"}
    ]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'helm',
    'tasks',
    '[{
      "id":"b-task",
      "title":"Account B task",
      "completed":false
    }]'::jsonb,
    '2026-07-31T12:00:00Z'
  ),
  (
    'legacy-unowned-browser',
    'helm',
    'tasks',
    '[{
      "id":"unowned-task",
      "title":"Unauthenticated browser data"
    }]'::jsonb,
    '2026-03-31T01:01:20Z'
  );
