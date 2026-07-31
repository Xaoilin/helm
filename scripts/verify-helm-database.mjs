import { readdirSync } from 'node:fs'

const managementApiBaseUrl =
  process.env.SUPABASE_MANAGEMENT_API_URL?.trim() || 'https://api.supabase.com'
const projectRef = requireEnv('SUPABASE_PROJECT_REF')
const accessToken = requireEnv('SUPABASE_ACCESS_TOKEN')
const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url)

const expectedMigrationVersions = readdirSync(migrationsDirectory)
  .filter(name => /^\d+_.+\.sql$/u.test(name))
  .map(name => name.slice(0, name.indexOf('_')))
  .sort()

const [migrationRows, verificationRows] = await Promise.all([
  queryDatabase(`
    select version
    from supabase_migrations.schema_migrations
    order by version;
  `),
  queryDatabase(`
    select jsonb_build_object(
      'helmTableCount', (
        select count(*)
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname = any(array[
            'helm_account_state', 'helm_records',
            'helm_mutation_receipts', 'helm_legacy_quarantine',
            'helm_secret_entries', 'helm_secret_mutation_receipts'
          ])
      ),
      'allHelmTablesUseRls', (
        select count(*) = 6 and bool_and(c.relrowsecurity)
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname = any(array[
            'helm_account_state', 'helm_records',
            'helm_mutation_receipts', 'helm_legacy_quarantine',
            'helm_secret_entries', 'helm_secret_mutation_receipts'
          ])
      ),
      'authenticatedRecordsRead', has_table_privilege('authenticated', 'public.helm_records', 'select'),
      'authenticatedRecordsWrite',
        has_table_privilege('authenticated', 'public.helm_records', 'insert')
        or has_table_privilege('authenticated', 'public.helm_records', 'update')
        or has_table_privilege('authenticated', 'public.helm_records', 'delete'),
      'anonymousRecordsRead', has_table_privilege('anon', 'public.helm_records', 'select'),
      'anonymousRecordsWrite',
        has_table_privilege('anon', 'public.helm_records', 'insert')
        or has_table_privilege('anon', 'public.helm_records', 'update')
        or has_table_privilege('anon', 'public.helm_records', 'delete'),
      'authenticatedReceiptRead', has_table_privilege('authenticated', 'public.helm_mutation_receipts', 'select'),
      'authenticatedSecretMetadataAccess',
        has_table_privilege('authenticated', 'public.helm_secret_entries', 'select')
        or has_table_privilege('authenticated', 'public.helm_secret_entries', 'insert')
        or has_table_privilege('authenticated', 'public.helm_secret_entries', 'update')
        or has_table_privilege('authenticated', 'public.helm_secret_entries', 'delete'),
      'anonymousSecretMetadataAccess',
        has_table_privilege('anon', 'public.helm_secret_entries', 'select')
        or has_table_privilege('anon', 'public.helm_secret_entries', 'insert')
        or has_table_privilege('anon', 'public.helm_secret_entries', 'update')
        or has_table_privilege('anon', 'public.helm_secret_entries', 'delete'),
      'authenticatedSecretReceiptRead', has_table_privilege(
        'authenticated', 'public.helm_secret_mutation_receipts', 'select'
      ),
      'authenticatedRpcExecute', has_function_privilege(
        'authenticated', 'public.apply_helm_mutations(uuid,jsonb)', 'execute'
      ),
      'anonymousRpcExecute', has_function_privilege(
        'anon', 'public.apply_helm_mutations(uuid,jsonb)', 'execute'
      ),
      'authenticatedSecretRpcExecute',
        has_function_privilege('authenticated', 'public.list_helm_secrets()', 'execute')
        and has_function_privilege('authenticated', 'public.reveal_helm_secret(uuid)', 'execute')
        and has_function_privilege(
          'authenticated',
          'public.save_helm_secret(uuid,uuid,text,text,text,text[],text,text,text,text,text)',
          'execute'
        )
        and has_function_privilege(
          'authenticated', 'public.set_helm_secret_archived(uuid,uuid,boolean)', 'execute'
        ),
      'anonymousSecretRpcExecute',
        has_function_privilege('anon', 'public.list_helm_secrets()', 'execute')
        or has_function_privilege('anon', 'public.reveal_helm_secret(uuid)', 'execute')
        or has_function_privilege(
          'anon',
          'public.save_helm_secret(uuid,uuid,text,text,text,text[],text,text,text,text,text)',
          'execute'
        )
        or has_function_privilege(
          'anon', 'public.set_helm_secret_archived(uuid,uuid,boolean)', 'execute'
        ),
      'secretRpcsAreSecurityDefiner', (
        select count(*) = 4 and bool_and(p.prosecdef)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any(array[
            'list_helm_secrets', 'reveal_helm_secret',
            'save_helm_secret', 'set_helm_secret_archived'
          ])
      ),
      'vaultInstalled', exists (
        select 1 from pg_extension where extname = 'supabase_vault'
      ),
      'authenticatedVaultUsage', has_schema_privilege('authenticated', 'vault', 'usage'),
      'rpcIsSecurityDefiner', (
        select p.prosecdef
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'apply_helm_mutations'
          and pg_get_function_identity_arguments(p.oid) = 'p_request_id uuid, p_operations jsonb'
      ),
      'accountReadPolicies', (
        select count(*)
        from pg_policies
        where schemaname = 'public'
          and tablename = any(array['helm_account_state', 'helm_records'])
          and cmd = 'SELECT'
          and roles = array['authenticated']::name[]
      ),
      'privateBroadcastPolicy', exists (
        select 1
        from pg_policies
        where schemaname = 'realtime'
          and tablename = 'messages'
          and policyname = 'HELM account broadcasts are private'
          and cmd = 'SELECT'
          and roles = array['authenticated']::name[]
      ),
      'legacyKvPublished', exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'kv_store'
      ),
      'authenticatedLegacyKvWrite',
        has_table_privilege('authenticated', 'public.kv_store', 'insert')
        or has_table_privilege('authenticated', 'public.kv_store', 'update')
        or has_table_privilege('authenticated', 'public.kv_store', 'delete'),
      'kvUserIdType', (
        select data_type
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'kv_store'
          and column_name = 'user_id'
      ),
      'legacyAccountsMissingState', (
        select count(*)
        from (
          select distinct kv.user_id::text::uuid as user_id
          from public.kv_store kv
          join auth.users account on account.id::text = kv.user_id::text
          where kv.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ) legacy
        left join public.helm_account_state state using (user_id)
        where state.user_id is null
      ),
      'minimumClientVersionsCorrect', coalesce((
        select bool_and(minimum_client_version = '0.2.83' and schema_version = 1)
        from public.helm_account_state
      ), true),
      'legacySnapshotsMatchManifest', not exists (
        select 1
        from public.helm_account_state state
        join lateral (
          select
            count(*) as row_count,
            encode(extensions.digest(convert_to(
              string_agg(kv.namespace || E'\\x1f' || kv.key || E'\\x1f' || kv.value::text, E'\\x1e'
                order by kv.namespace, kv.key),
              'UTF8'
            ), 'sha256'), 'hex') as snapshot_sha256
          from public.kv_store kv
          where kv.user_id::text = state.user_id::text
        ) current on true
        where current.row_count <> (state.legacy_manifest ->> 'rowCount')::bigint
          or current.snapshot_sha256 <> state.legacy_manifest ->> 'snapshotSha256'
      ),
      'ordinaryLegacyCollectionsExact', not exists (
        select 1
        from public.kv_store kv
        join auth.users account on account.id::text = kv.user_id::text
        join lateral (
          select
            count(*)::bigint as record_count,
            encode(extensions.digest(convert_to(
              coalesce(jsonb_agg(
                case when kv.key = 'projects'
                  then item.value - 'localPath' - 'projectRoot' - 'approvedProfiles'
                    - 'fingerprint' - 'processes' - 'logs'
                  else item.value
                end
                order by item.ordinal
              ), '[]'::jsonb)::text,
              'UTF8'
            ), 'sha256'), 'hex') as payload_sha256
          from (
            select candidate.value, candidate.ordinal
            from jsonb_array_elements(kv.value) with ordinality candidate(value, ordinal)
            where jsonb_typeof(candidate.value) = 'object'
              and nullif(candidate.value ->> 'id', '') is not null
              and length(candidate.value ->> 'id') <= 256
              and 1 = (
                select count(*)
                from jsonb_array_elements(kv.value) duplicate
                where nullif(duplicate ->> 'id', '') = nullif(candidate.value ->> 'id', '')
              )
          ) item
        ) expected on true
        join lateral (
          select
            count(*)::bigint as record_count,
            encode(extensions.digest(convert_to(
              coalesce(jsonb_agg(records.payload order by records.position, records.record_id), '[]'::jsonb)::text,
              'UTF8'
            ), 'sha256'), 'hex') as payload_sha256
          from public.helm_records records
          where records.user_id = account.id
            and records.collection = kv.key
            and records.deleted_at is null
        ) actual on true
        where kv.namespace = 'helm'
          and jsonb_typeof(kv.value) = 'array'
          and kv.key = any(array[
            'integrations', 'conversations',
            'calendarAccounts', 'calendarSources', 'calendarEvents',
            'captureItems',
            'trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries',
            'projects', 'projectPages', 'tasks', 'dashboardFocusFeedback',
            'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems', 'healthFastFoodEntries',
            'financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals',
            'assistantCorrections', 'assistantActivityLog'
          ])
          and (expected.record_count, expected.payload_sha256)
            is distinct from (actual.record_count, actual.payload_sha256)
      ),
      'goldenCatalogueCurrent', coalesce((
        select
          count(*) = 21
          and count(*) filter (where coalesce((record.payload ->> 'isPinned')::boolean, false)) = 6
          and count(*) filter (
            where not coalesce((record.payload ->> 'isPinned')::boolean, false)
              and record.payload ->> 'status' <> 'archived'
          ) = 13
          and count(*) filter (where record.payload ->> 'status' = 'archived') = 2
          and encode(extensions.digest(convert_to(
            string_agg(record.record_id, E'\\x1f' order by record.position), 'UTF8'
          ), 'sha256'), 'hex') = 'd027cc0f6bb063890b7311d3403903d4261462160a8f48e3f34f8b71456977e1'
        from public.helm_records record
        join auth.users account on account.id = record.user_id
        where (lower(account.email) = 'alisab.london'
            or lower(split_part(account.email, '@', 1)) = 'alisab.london')
          and record.collection = 'projects'
          and record.deleted_at is null
      ), false),
      'legacyAccountIsolationCurrent', coalesce((
        select
          count(*) filter (where record.collection = 'financeAccounts') = 2
          and count(*) filter (where record.collection = 'transactions') = 58
          and count(*) filter (where record.collection = 'tasks') = 11
          and count(*) filter (where record.collection = 'conversations') = 1
        from public.helm_records record
        join auth.users account on account.id = record.user_id
        where (lower(account.email) = 'xaoilin'
            or lower(split_part(account.email, '@', 1)) = 'xaoilin')
          and record.deleted_at is null
          and record.collection = any(array['financeAccounts','transactions','tasks','conversations'])
      ), false),
      'unownedLegacyRowsStayUnattached', not exists (
        select 1
        from public.kv_store kv
        left join auth.users account on account.id::text = kv.user_id::text
        join public.helm_account_state state on state.user_id::text = kv.user_id::text
        where account.id is null
      )
    ) as verification;
  `),
])

const actualMigrationVersions = migrationRows.map(row => String(row.version)).sort()
if (JSON.stringify(actualMigrationVersions) !== JSON.stringify(expectedMigrationVersions)) {
  throw new Error(
    `Migration history mismatch. Expected ${expectedMigrationVersions.join(', ') || 'none'}; `
      + `found ${actualMigrationVersions.join(', ') || 'none'}.`,
  )
}

const verification = verificationRows[0]?.verification
if (!verification || typeof verification !== 'object') {
  throw new Error('Database verification query did not return a verification object.')
}

const expected = {
  helmTableCount: 6,
  allHelmTablesUseRls: true,
  authenticatedRecordsRead: true,
  authenticatedRecordsWrite: false,
  anonymousRecordsRead: false,
  anonymousRecordsWrite: false,
  authenticatedReceiptRead: false,
  authenticatedSecretMetadataAccess: false,
  anonymousSecretMetadataAccess: false,
  authenticatedSecretReceiptRead: false,
  authenticatedRpcExecute: true,
  anonymousRpcExecute: false,
  authenticatedSecretRpcExecute: true,
  anonymousSecretRpcExecute: false,
  secretRpcsAreSecurityDefiner: true,
  vaultInstalled: true,
  authenticatedVaultUsage: false,
  rpcIsSecurityDefiner: true,
  accountReadPolicies: 2,
  privateBroadcastPolicy: true,
  legacyKvPublished: false,
  authenticatedLegacyKvWrite: false,
  kvUserIdType: 'text',
  legacyAccountsMissingState: 0,
  minimumClientVersionsCorrect: true,
  legacySnapshotsMatchManifest: true,
  ordinaryLegacyCollectionsExact: true,
  goldenCatalogueCurrent: true,
  legacyAccountIsolationCurrent: true,
  unownedLegacyRowsStayUnattached: true,
}

const failures = Object.entries(expected)
  .filter(([key, value]) => verification[key] !== value)
  .map(([key, value]) => `${key}: expected ${JSON.stringify(value)}, found ${JSON.stringify(verification[key])}`)

if (failures.length > 0) {
  throw new Error(`HELM database verification failed:\n- ${failures.join('\n- ')}`)
}

console.log(
  `Verified HELM database schema, migration history, RLS, RPC, and private Broadcast on ${projectRef}.`,
)

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required to verify the HELM database.`)
  return value
}

async function queryDatabase(query) {
  const response = await fetch(
    `${managementApiBaseUrl}/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  if (!response.ok) {
    const responseText = (await response.text()).trim()
    throw new Error(
      `Supabase database verification query failed with ${response.status}: ${responseText || 'No response body.'}`,
    )
  }
  const body = await response.json()
  if (!Array.isArray(body)) throw new Error('Supabase database verification returned an unexpected response.')
  return body
}
