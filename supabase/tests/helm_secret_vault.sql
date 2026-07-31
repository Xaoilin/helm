begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

select has_table('public', 'helm_secret_entries', 'secret metadata table exists');
select has_table('public', 'helm_secret_mutation_receipts', 'secret idempotency table exists');
select has_function('public', 'list_helm_secrets', array[]::text[], 'secret list RPC exists');
select has_function('public', 'reveal_helm_secret', array['uuid'], 'secret reveal RPC exists');
select has_function(
  'public',
  'save_helm_secret',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text[]', 'text', 'text', 'text', 'text', 'text'],
  'secret save RPC exists'
);
select has_function(
  'public',
  'set_helm_secret_archived',
  array['uuid', 'uuid', 'boolean'],
  'secret archive RPC exists'
);
select ok(
  exists(select 1 from pg_extension where extname = 'supabase_vault'),
  'Supabase Vault is installed'
);
select ok(
  not has_schema_privilege('authenticated', 'vault', 'usage'),
  'authenticated clients cannot access Vault directly'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '66666666-6666-4666-8666-666666666666',
    'authenticated', 'authenticated', 'helm-secret-a@example.test', '', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '77777777-7777-4777-8777-777777777777',
    'authenticated', 'authenticated', 'helm-secret-b@example.test', '', now(), now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated","is_anonymous":false}',
  true
);

select throws_ok(
  $$select count(*) from public.helm_secret_entries$$,
  '42501',
  'permission denied for table helm_secret_entries',
  'authenticated clients cannot read secret metadata directly'
);

select throws_ok(
  $$insert into public.helm_secret_entries (
      user_id, label, kind, vault_secret_id, account_version
    ) values (
      '66666666-6666-4666-8666-666666666666', 'Forged', 'password', gen_random_uuid(), 1
    )$$,
  '42501',
  'permission denied for table helm_secret_entries',
  'authenticated clients cannot write secret metadata directly'
);

select lives_ok(
  $$select public.save_helm_secret(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', null,
    'Production database', 'database', 'production', array['catalog:helm'],
    'never-return-in-a-list', 'postgres', 'https://example.test', 'Primary database',
    'cutover:supabase-db-password:v1'
  )$$,
  'a signed-in account can create an encrypted secret'
);

select is(
  jsonb_array_length(public.list_helm_secrets() -> 'secrets'),
  1,
  'secret metadata is listed for its owner'
);

select ok(
  position('never-return-in-a-list' in public.list_helm_secrets()::text) = 0,
  'secret plaintext is never returned by the list RPC'
);

select is(
  (
    select public.reveal_helm_secret((entry ->> 'secretId')::uuid) ->> 'value'
    from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry
  ),
  'never-return-in-a-list',
  'the owner can reveal one secret on demand'
);

select lives_ok(
  $$select public.save_helm_secret(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', null,
    'Production database', 'database', 'production', array['catalog:helm'],
    'never-return-in-a-list', 'postgres', 'https://example.test', 'Primary database',
    'cutover:supabase-db-password:v1'
  )$$,
  'retrying a secret mutation request is idempotent'
);

select is(
  jsonb_array_length(public.list_helm_secrets() -> 'secrets'),
  1,
  'an idempotent retry does not duplicate a secret'
);

select throws_ok(
  $$select public.save_helm_secret(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', null,
    'Duplicate import', 'database', 'production', array['catalog:helm'],
    'different-value', null, null, null,
    'cutover:supabase-db-password:v1'
  )$$,
  '23505',
  null,
  'a stable import source cannot create duplicate active metadata'
);

select lives_ok(
  $$select public.save_helm_secret(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
    (select (entry ->> 'secretId')::uuid from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry),
    'Production database password', 'database', 'production', array['catalog:helm'],
    null, 'postgres', 'https://example.test/database', 'Rotated credential',
    'cutover:supabase-db-password:v1'
  )$$,
  'metadata can be edited without resending the secret value'
);

select is(
  (
    select public.reveal_helm_secret((entry ->> 'secretId')::uuid) ->> 'value'
    from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry
  ),
  'never-return-in-a-list',
  'metadata-only edits retain the encrypted value'
);

select is(
  (
    select (entry ->> 'revision')::integer
    from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry
  ),
  2,
  'secret edits advance their revision'
);

select lives_ok(
  $$select public.set_helm_secret_archived(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    (select (entry ->> 'secretId')::uuid from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry),
    true
  )$$,
  'a secret can be archived reversibly'
);

select lives_ok(
  $$select public.set_helm_secret_archived(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    (select (entry ->> 'secretId')::uuid from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry),
    true
  )$$,
  'retrying an archive request is idempotent'
);

select is(
  (
    select (entry ->> 'revision')::integer
    from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry
  ),
  3,
  'an idempotent archive retry does not advance the revision twice'
);

select throws_ok(
  $$select public.reveal_helm_secret(
    (select (entry ->> 'secretId')::uuid from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry)
  )$$,
  'P0002',
  'The HELM secret is unavailable.',
  'archived values cannot be revealed until restored'
);

select lives_ok(
  $$select public.set_helm_secret_archived(
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd5',
    (select (entry ->> 'secretId')::uuid from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry),
    false
  )$$,
  'an archived secret can be restored'
);

select is(
  (
    select entry ->> 'archivedAt'
    from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry
  ),
  null,
  'restore clears the archive marker'
);

select set_config(
  'helm.test_secret_id',
  (select entry ->> 'secretId' from jsonb_array_elements(public.list_helm_secrets() -> 'secrets') entry),
  true
);

select set_config(
  'request.jwt.claims',
  '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated","is_anonymous":false}',
  true
);

select is(
  jsonb_array_length(public.list_helm_secrets() -> 'secrets'),
  0,
  'another account cannot list the owner secret'
);

select throws_ok(
  $$select public.reveal_helm_secret(current_setting('helm.test_secret_id')::uuid)$$,
  'P0002',
  'The HELM secret is unavailable.',
  'another account cannot reveal a known owner secret id'
);

reset role;
set local role anon;
select set_config(
  'request.jwt.claims',
  '{"sub":null,"role":"anon","is_anonymous":true}',
  true
);

select throws_ok(
  $$select public.list_helm_secrets()$$,
  '42501',
  'permission denied for function list_helm_secrets',
  'anonymous sessions cannot execute secret RPCs'
);

reset role;
select * from finish();
rollback;
