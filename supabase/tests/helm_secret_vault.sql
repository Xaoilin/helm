begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

select has_table('public', 'helm_secret_entries', 'secret metadata schema exists');
select has_table('public', 'helm_secret_mutation_receipts', 'secret receipt schema exists');
select has_function('public', 'list_helm_secrets', array[]::text[], 'secret list RPC exists');
select has_function('public', 'reveal_helm_secret', array['uuid'], 'secret reveal RPC exists');
select has_function(
  'public', 'save_helm_secret',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text[]', 'text', 'text', 'text', 'text', 'text'],
  'secret save RPC exists'
);
select has_function(
  'public', 'set_helm_secret_archived', array['uuid', 'uuid', 'boolean'],
  'secret archive RPC exists'
);
select ok(
  exists (select 1 from pg_extension where extname = 'supabase_vault'),
  'Supabase Vault is installed for encrypted values'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.helm_secret_entries'::regclass),
  'secret metadata has row-level security enabled'
);
select ok(
  not has_schema_privilege('authenticated', 'vault', 'usage'),
  'authenticated callers cannot enter the Vault schema directly'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);
select throws_ok(
  $$select count(*) from public.helm_secret_entries$$,
  '42501',
  'permission denied for table helm_secret_entries',
  'authenticated callers cannot read secret metadata directly'
);
select ok(
  set_config(
    'helm.test_secret_id',
    (
      public.save_helm_secret(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', null,
        'Account A database', 'database', 'production', array['catalog:a-project']::text[],
        'vault-contract-marker', 'database-user', 'https://example.test',
        'opaque test notes', 'source:account-a'
      ) ->> 'secretId'
    ),
    true
  ) <> '',
  'an authenticated owner can create account-owned secret metadata'
);
select is(
  jsonb_array_length(public.list_helm_secrets() -> 'secrets'),
  1,
  'the owner can list only its secret metadata'
);
select ok(
  not ((public.list_helm_secrets() -> 'secrets' -> 0) ? 'value'),
  'secret list metadata never contains plaintext'
);
select is(
  (public.list_helm_secrets() ->> 'accountVersion')::bigint,
  2::bigint,
  'secret creation advances the owning account version'
);
select ok(
  (
    public.reveal_helm_secret(current_setting('helm.test_secret_id')::uuid) ->> 'value'
  ) = 'vault-contract-marker',
  'the owner can reveal the encrypted value on demand'
);
select is(
  public.save_helm_secret(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', null,
    'Different retry', 'other', null, '{}'::text[],
    'different retry value', null, null, null, 'different-source'
  ) ->> 'secretId',
  current_setting('helm.test_secret_id'),
  'reusing a secret request id returns its original result'
);
select is(
  jsonb_array_length(public.list_helm_secrets() -> 'secrets'),
  1,
  'an idempotent secret retry does not create another metadata row'
);
select is(
  (
    public.save_helm_secret(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002',
      current_setting('helm.test_secret_id')::uuid,
      'Renamed database', 'database', 'production', array['catalog:a-project']::text[],
      null, 'rotated-user', 'https://example.test/rotated',
      'updated opaque notes', 'source:account-a'
    ) ->> 'revision'
  )::bigint,
  2::bigint,
  'metadata updates advance the secret revision'
);
select ok(
  (
    public.reveal_helm_secret(current_setting('helm.test_secret_id')::uuid) ->> 'value'
  ) = 'vault-contract-marker',
  'metadata-only updates preserve the encrypted value'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',
  true
);
select is(
  jsonb_array_length(public.list_helm_secrets() -> 'secrets'),
  0,
  'a second account cannot list the first account metadata'
);
select throws_ok(
  $$select public.reveal_helm_secret(current_setting('helm.test_secret_id')::uuid)$$,
  'P0002',
  'The HELM secret is unavailable.',
  'a second account cannot reveal the first account value'
);
select throws_ok(
  $$select count(*) from public.helm_secret_entries$$,
  '42501',
  'permission denied for table helm_secret_entries',
  'a second account cannot bypass the secret RPC'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',
  true
);
select ok(
  (public.set_helm_secret_archived(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0003',
    current_setting('helm.test_secret_id')::uuid,
    true
  ) ->> 'archivedAt') is not null,
  'the owner can archive a secret without deleting its metadata'
);
select throws_ok(
  $$select public.reveal_helm_secret(current_setting('helm.test_secret_id')::uuid)$$,
  'P0002',
  'The HELM secret is unavailable.',
  'archived secret values are unavailable to reveal'
);
select ok(
  (public.set_helm_secret_archived(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0004',
    current_setting('helm.test_secret_id')::uuid,
    false
  ) ->> 'archivedAt') is null,
  'the owner can restore archived secret metadata'
);
select ok(
  (
    public.reveal_helm_secret(current_setting('helm.test_secret_id')::uuid) ->> 'value'
  ) = 'vault-contract-marker',
  'restoring metadata restores on-demand reveal'
);

reset role;
select ok(
  exists (
    select 1
    from public.helm_secret_entries
    where user_id = '11111111-1111-4111-8111-111111111111'
      and vault_secret_id is not null
  ),
  'secret metadata stores only an account-owned Vault reference'
);
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
  'anonymous callers cannot execute secret RPCs'
);

reset role;
select * from finish();
rollback;
