import {
  classifyMigrationHistory,
  formatMigrationEntries,
  readRepositoryMigrations,
} from './lib/migrationHistory.mjs'

const managementApiBaseUrl =
  process.env.SUPABASE_MANAGEMENT_API_URL?.trim() || 'https://api.supabase.com'
const projectRef = requireEnv('SUPABASE_PROJECT_REF')
const accessToken = requireEnv('SUPABASE_ACCESS_TOKEN')
const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url)

const expectedMigrations = readRepositoryMigrations(migrationsDirectory)

const [migrationRows, verificationRows] = await Promise.all([
  queryDatabase(`
    select version, name
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
            'helm_secret_entries', 'helm_secret_mutation_receipts',
            'product_usage_events'
          ])
      ),
      'allHelmTablesUseRls', (
        select count(*) = 5 and bool_and(c.relrowsecurity)
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname = any(array[
            'helm_account_state', 'helm_records',
            'helm_secret_entries', 'helm_secret_mutation_receipts',
            'product_usage_events'
          ])
      ),
      'authenticatedRecordsRead', has_table_privilege('authenticated', 'public.helm_records', 'select'),
      'oauthApprovalTablesPrivate', (
        select count(*) = 4 and bool_and(
          c.relrowsecurity
          and not has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')
          and not has_table_privilege('anon', c.oid, 'select,insert,update,delete')
        )
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname = any(array[
            'helm_inventory_oauth_clients', 'helm_employment_oauth_clients',
            'helm_equity_oauth_clients', 'helm_finance_oauth_clients'
          ])
      ),
      'oauthApprovalRpcsRestricted', (
        select count(*) = 12 and bool_and(
          p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute')
          and array_to_string(p.proconfig, ',') like '%search_path=""%'
        )
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any(array[
          'approve_inventory_oauth_client', 'list_inventory_oauth_clients', 'revoke_inventory_oauth_client',
          'approve_employment_oauth_client', 'list_employment_oauth_clients', 'revoke_employment_oauth_client',
          'approve_equity_oauth_client', 'list_equity_oauth_clients', 'revoke_equity_oauth_client',
          'approve_finance_oauth_client', 'list_finance_oauth_clients', 'revoke_finance_oauth_client'
        ])
      ),
      'genericStoreRetired', not exists (
        select 1
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'helm_private')
          and (
            p.proname like 'get_helm_%'
            or p.proname like 'apply_helm_%'
            or p.proname like 'inventory\_%'
            or p.proname like 'employment\_%'
            or p.proname like 'equity\_%'
            or p.proname like 'finance\_%'
            or p.proname like 'mutate\_%'
            or p.proname = 'apply_inventory_mutations'
          )
      ) and not exists (
        select 1
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and (c.relname like 'helm\_%mutation_receipts' and c.relname <> 'helm_secret_mutation_receipts'
            or c.relname = 'helm_legacy_quarantine')
      ),
      'authenticatedRecordsWrite',
        has_table_privilege('authenticated', 'public.helm_records', 'insert')
        or has_table_privilege('authenticated', 'public.helm_records', 'update')
        or has_table_privilege('authenticated', 'public.helm_records', 'delete'),
      'anonymousRecordsRead', has_table_privilege('anon', 'public.helm_records', 'select'),
      'anonymousRecordsWrite',
        has_table_privilege('anon', 'public.helm_records', 'insert')
        or has_table_privilege('anon', 'public.helm_records', 'update')
        or has_table_privilege('anon', 'public.helm_records', 'delete'),
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
      'deprecatedFeaturesRemoved', not exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and (c.relname like 'life_hero%' or c.relname like 'github_life_hero%')
      ) and not exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'helm_private')
          and p.proname like '%life_hero%'
      ) and not exists (
        select 1 from pg_trigger
        where tgrelid = 'auth.users'::regclass and tgname = 'life_hero_initialize_profile'
      ) and not exists (
        select 1 from public.helm_records
        where collection = any(array['conversations', 'assistantCorrections', 'assistantActivityLog'])
      ),
      'productUsageOwnerReadPolicy', (
        select count(*) = 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'product_usage_events'
          and cmd = 'SELECT'
          and roles = array['authenticated']::name[]
      ),
      'productUsagePrivileges',
        has_table_privilege('authenticated', 'public.product_usage_events', 'select')
        and not has_table_privilege('authenticated', 'public.product_usage_events', 'insert')
        and not has_table_privilege('authenticated', 'public.product_usage_events', 'update')
        and not has_table_privilege('authenticated', 'public.product_usage_events', 'delete')
        and not has_table_privilege('anon', 'public.product_usage_events', 'select'),
      'productUsageIngestRetired',
        to_regprocedure('public.ingest_product_usage_events(jsonb)') is null,
      'productUsageRowsContentFree', not exists (
        select 1
        from public.product_usage_events event
        where not helm_private.product_usage_metadata_is_safe(event.metadata)
          or event.feature !~ '^[a-z][a-z0-9_]{0,63}$'
          or event.action !~ '^[a-z][a-z0-9_]{0,63}$'
      ),
      'accountReadPolicies', (
        select count(*)
        from pg_policies
        where schemaname = 'public'
          and tablename = any(array['helm_account_state', 'helm_records'])
          and cmd = 'SELECT'
          and roles = array['authenticated']::name[]
      ),
      'broadcastRetired', not exists (
        select 1
        from pg_policies
        where schemaname = 'realtime'
          and tablename = 'messages'
          and policyname = 'HELM account broadcasts are private'
      ) and not exists (
        select 1
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'helm_private') and p.prosrc like '%realtime.send%'
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
        -- 0.2.83 is the complete-snapshot floor. Accounts that have used the
        -- Inventory RPC are intentionally advanced to its 0.2.86 floor.
        -- Keep this an explicit allowlist so unknown or future floors fail.
        select bool_and(
          minimum_client_version = any(array['0.2.83', '0.2.86']::text[])
          and schema_version = 1
        )
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

const migrationHistory = classifyMigrationHistory({
  repositoryMigrations: expectedMigrations,
  actualMigrations: migrationRows.map(row => ({
    version: String(row.version),
    name: String(row.name ?? ''),
  })),
})
if (migrationHistory.unexpectedMigrations.length > 0) {
  throw new Error(
    'Migration history contains unexpected or mismatched entries: '
      + `${formatMigrationEntries(migrationHistory.unexpectedMigrations)}.`,
  )
}
if (migrationHistory.missingOwnedMigrations.length > 0) {
  throw new Error(
    'Migration history is missing HELM-owned entries: '
      + `${formatMigrationEntries(migrationHistory.missingOwnedMigrations)}.`,
  )
}

const verification = verificationRows[0]?.verification
if (!verification || typeof verification !== 'object') {
  throw new Error('Database verification query did not return a verification object.')
}

const expected = {
  helmTableCount: 5,
  allHelmTablesUseRls: true,
  authenticatedRecordsRead: true,
  oauthApprovalTablesPrivate: true,
  oauthApprovalRpcsRestricted: true,
  genericStoreRetired: true,
  authenticatedRecordsWrite: false,
  anonymousRecordsRead: false,
  anonymousRecordsWrite: false,
  authenticatedSecretMetadataAccess: false,
  anonymousSecretMetadataAccess: false,
  authenticatedSecretReceiptRead: false,
  authenticatedSecretRpcExecute: true,
  anonymousSecretRpcExecute: false,
  secretRpcsAreSecurityDefiner: true,
  vaultInstalled: true,
  authenticatedVaultUsage: false,
  deprecatedFeaturesRemoved: true,
  productUsageOwnerReadPolicy: true,
  productUsagePrivileges: true,
  productUsageIngestRetired: true,
  productUsageRowsContentFree: true,
  accountReadPolicies: 2,
  broadcastRetired: true,
  legacyKvPublished: false,
  authenticatedLegacyKvWrite: false,
  kvUserIdType: 'text',
  legacyAccountsMissingState: 0,
  minimumClientVersionsCorrect: true,
  legacySnapshotsMatchManifest: true,
  unownedLegacyRowsStayUnattached: true,
}

const failures = Object.entries(expected)
  .filter(([key, value]) => verification[key] !== value)
  .map(([key, value]) => `${key}: expected ${JSON.stringify(value)}, found ${JSON.stringify(verification[key])}`)

if (failures.length > 0) {
  throw new Error(`HELM database verification failed:\n- ${failures.join('\n- ')}`)
}

console.log(
  `Verified HELM database schema, migration history, RLS, secret and OAuth approval RPCs, and the retired record store on ${projectRef}.`,
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
