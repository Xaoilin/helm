import { appendFileSync, readdirSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

const managementApiBaseUrl =
  process.env.SUPABASE_MANAGEMENT_API_URL?.trim() || 'https://api.supabase.com'
const projectRef = requireEnv('SUPABASE_PROJECT_REF')
const accessToken = requireEnv('SUPABASE_ACCESS_TOKEN')
const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url)
const historicalVersions = ['20260415090000', '20260501090000']
const repositoryVersions = readdirSync(migrationsDirectory)
  .filter(name => /^\d+_.+\.sql$/u.test(name))
  .map(name => name.slice(0, name.indexOf('_')))
  .sort()

const [{ migrationTable, audit }] = await queryDatabase(`
  select
    to_regclass('supabase_migrations.schema_migrations')::text as "migrationTable",
    jsonb_build_object(
      'columns', (
        select jsonb_object_agg(table_name, columns order by table_name)
        from (
          select table_name, jsonb_agg(jsonb_build_object(
            'name', column_name,
            'type', data_type,
            'udt', udt_name,
            'nullable', is_nullable,
            'default', column_default,
            'ordinal', ordinal_position
          ) order by ordinal_position) as columns
          from information_schema.columns
          where table_schema = 'public'
            and table_name in ('kv_store', 'google_calendar_credentials')
          group by table_name
        ) tables
      ),
      'constraints', (
        select jsonb_agg(jsonb_build_object(
          'table', relation.relname,
          'name', constraint_row.conname,
          'type', constraint_row.contype,
          'definition', pg_get_constraintdef(constraint_row.oid, true)
        ) order by relation.relname, constraint_row.conname)
        from pg_constraint constraint_row
        join pg_class relation on relation.oid = constraint_row.conrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname in ('kv_store', 'google_calendar_credentials')
      ),
      'indexes', (
        select jsonb_agg(jsonb_build_object(
          'table', tablename,
          'name', indexname,
          'definition', indexdef
        ) order by tablename, indexname)
        from pg_indexes
        where schemaname = 'public'
          and tablename in ('kv_store', 'google_calendar_credentials')
      ),
      'policies', (
        select jsonb_agg(to_jsonb(policy) order by tablename, policyname)
        from pg_policies policy
        where schemaname = 'public'
          and tablename in ('kv_store', 'google_calendar_credentials')
      ),
      'triggers', (
        select jsonb_agg(jsonb_build_object(
          'table', event_object_table,
          'name', trigger_name,
          'action', action_statement,
          'timing', action_timing,
          'event', event_manipulation
        ) order by event_object_table, trigger_name)
        from information_schema.triggers
        where trigger_schema = 'public'
          and event_object_table in ('kv_store', 'google_calendar_credentials')
      ),
      'rls', (
        select jsonb_object_agg(relation.relname, relation.relrowsecurity)
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname in ('kv_store', 'google_calendar_credentials')
      ),
      'updatedAtFunctionBody', (
        select regexp_replace(procedure.prosrc, '\\s+', ' ', 'g')
        from pg_proc procedure
        join pg_namespace namespace on namespace.oid = procedure.pronamespace
        where namespace.nspname = 'public'
          and procedure.proname = 'set_google_calendar_credentials_updated_at'
          and pg_get_function_identity_arguments(procedure.oid) = ''
      ),
      'helmTablesAbsent', not exists (
        select 1
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname like 'helm_%'
      )
    ) as audit;
`)

let actualVersions = []
if (migrationTable) {
  actualVersions = (await queryDatabase(`
    select version
    from supabase_migrations.schema_migrations
    order by version;
  `)).map(row => String(row.version))
}

const unexpectedVersions = actualVersions.filter(version => !repositoryVersions.includes(version))
if (unexpectedVersions.length > 0) {
  throw new Error(`Production has unexpected migration versions: ${unexpectedVersions.join(', ')}.`)
}

const missingHistoricalVersions = historicalVersions.filter(version => !actualVersions.includes(version))
const newerVersionsAlreadyTracked = actualVersions.filter(version => !historicalVersions.includes(version))
if (missingHistoricalVersions.length > 0 && newerVersionsAlreadyTracked.length > 0) {
  throw new Error(
    'Historical migration entries cannot be repaired after a newer HELM migration is already tracked.',
  )
}

if (missingHistoricalVersions.length > 0) {
  const expectedAudit = historicalSchemaAudit()
  if (!isDeepStrictEqual(audit, expectedAudit)) {
    throw new Error(
      'Production schema is not exactly equivalent to the historical HELM migrations; migration history was not changed.',
    )
  }
}

const output = missingHistoricalVersions.join(',')
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `missing_versions=${output}\n`)
}
console.log(
  output
    ? `Proved historical schema equivalence; migration repair is allowed for ${output}.`
    : 'Historical migration entries are already tracked; no repair is needed.',
)

function historicalSchemaAudit() {
  return {
    columns: {
      kv_store: [
        { udt: 'text', name: 'namespace', type: 'text', default: null, ordinal: 1, nullable: 'NO' },
        { udt: 'text', name: 'key', type: 'text', default: null, ordinal: 2, nullable: 'NO' },
        { udt: 'jsonb', name: 'value', type: 'jsonb', default: null, ordinal: 3, nullable: 'NO' },
        { udt: 'timestamptz', name: 'updated_at', type: 'timestamp with time zone', default: 'now()', ordinal: 4, nullable: 'NO' },
        { udt: 'text', name: 'user_id', type: 'text', default: null, ordinal: 5, nullable: 'NO' },
      ],
      google_calendar_credentials: [
        { udt: 'uuid', name: 'user_id', type: 'uuid', default: null, ordinal: 1, nullable: 'NO' },
        { udt: 'text', name: 'google_email', type: 'text', default: null, ordinal: 2, nullable: 'NO' },
        { udt: 'text', name: 'refresh_token', type: 'text', default: null, ordinal: 3, nullable: 'NO' },
        { udt: 'text', name: 'access_token', type: 'text', default: null, ordinal: 4, nullable: 'YES' },
        { udt: 'timestamptz', name: 'access_token_expires_at', type: 'timestamp with time zone', default: null, ordinal: 5, nullable: 'YES' },
        { udt: 'text', name: 'scope', type: 'text', default: null, ordinal: 6, nullable: 'YES' },
        { udt: 'text', name: 'credential_origin', type: 'text', default: "'oauth_code'::text", ordinal: 7, nullable: 'NO' },
        { udt: 'timestamptz', name: 'last_refresh_at', type: 'timestamp with time zone', default: null, ordinal: 8, nullable: 'YES' },
        { udt: 'text', name: 'last_refresh_failure_reason', type: 'text', default: null, ordinal: 9, nullable: 'YES' },
        { udt: 'timestamptz', name: 'last_refresh_failure_at', type: 'timestamp with time zone', default: null, ordinal: 10, nullable: 'YES' },
        { udt: 'timestamptz', name: 'revoked_at', type: 'timestamp with time zone', default: null, ordinal: 11, nullable: 'YES' },
        { udt: 'timestamptz', name: 'created_at', type: 'timestamp with time zone', default: "timezone('utc'::text, now())", ordinal: 12, nullable: 'NO' },
        { udt: 'timestamptz', name: 'updated_at', type: 'timestamp with time zone', default: "timezone('utc'::text, now())", ordinal: 13, nullable: 'NO' },
      ],
    },
    constraints: [
      { name: 'google_calendar_credentials_origin_check', type: 'c', table: 'google_calendar_credentials', definition: "CHECK (credential_origin = ANY (ARRAY['oauth_code'::text, 'profile_session'::text]))" },
      { name: 'google_calendar_credentials_pkey', type: 'p', table: 'google_calendar_credentials', definition: 'PRIMARY KEY (user_id, google_email)' },
      { name: 'google_calendar_credentials_user_id_fkey', type: 'f', table: 'google_calendar_credentials', definition: 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE' },
      { name: 'kv_store_pkey', type: 'p', table: 'kv_store', definition: 'PRIMARY KEY (user_id, namespace, key)' },
    ],
    indexes: [
      { name: 'google_calendar_credentials_pkey', table: 'google_calendar_credentials', definition: 'CREATE UNIQUE INDEX google_calendar_credentials_pkey ON public.google_calendar_credentials USING btree (user_id, google_email)' },
      { name: 'google_calendar_credentials_user_id_idx', table: 'google_calendar_credentials', definition: 'CREATE INDEX google_calendar_credentials_user_id_idx ON public.google_calendar_credentials USING btree (user_id)' },
      { name: 'kv_store_pkey', table: 'kv_store', definition: 'CREATE UNIQUE INDEX kv_store_pkey ON public.kv_store USING btree (user_id, namespace, key)' },
    ],
    policies: [{
      cmd: 'ALL',
      qual: '((auth.uid())::text = user_id)',
      roles: ['public'],
      tablename: 'kv_store',
      permissive: 'PERMISSIVE',
      policyname: 'User isolation',
      schemaname: 'public',
      with_check: null,
    }],
    triggers: [{
      name: 'google_calendar_credentials_set_updated_at',
      event: 'UPDATE',
      table: 'google_calendar_credentials',
      action: 'EXECUTE FUNCTION set_google_calendar_credentials_updated_at()',
      timing: 'BEFORE',
    }],
    rls: { kv_store: true, google_calendar_credentials: true },
    updatedAtFunctionBody: " begin new.updated_at = timezone('utc', now()); return new; end; ",
    helmTablesAbsent: true,
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required to reconcile HELM migration history.`)
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
      `Supabase schema-equivalence query failed with ${response.status}: ${responseText || 'No response body.'}`,
    )
  }
  const body = await response.json()
  if (!Array.isArray(body)) throw new Error('Supabase schema-equivalence query returned an unexpected response.')
  return body
}
