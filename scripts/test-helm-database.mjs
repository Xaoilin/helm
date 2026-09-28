import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const supabaseCli = process.platform === 'win32'
  ? 'node_modules/.bin/supabase.cmd'
  : 'node_modules/.bin/supabase'
const isolatedCi = process.env.CI === 'true'

let failure = null
try {
  run(['db', 'reset', '--local', '--version', '20260501090000', '--no-seed'])
  runSqlFile('supabase/tests/fixtures/helm_legacy_accounts.sql')
  run(['migration', 'up', '--local'])
  run([
    'test', 'db', '--local',
    'supabase/tests/helm_secret_vault.sql',
    'supabase/tests/sabah_one_oauth_approvals.sql',
    'supabase/tests/product_usage_analytics.sql',
    'supabase/tests/remove_deprecated_features.sql',
    'supabase/tests/retire_google_broker_and_project_resolve.sql',
    'supabase/tests/retire_generic_store.sql',
  ])
} catch (error) {
  failure = error
} finally {
  if (isolatedCi) {
    console.log('Skipping final database reset in the ephemeral CI environment.')
  } else {
    try {
      run(['db', 'reset', '--local', '--no-seed'])
    } catch (resetError) {
      if (!failure) failure = resetError
    }
  }
}

if (failure) throw failure

function runSqlFile(path) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_helm', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
      input: readFileSync(path, 'utf8'),
      stdio: ['pipe', 'inherit', 'inherit'],
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Failed to load SQL fixture: ${path}`)
}

function run(arguments_) {
  const result = spawnSync(supabaseCli, arguments_, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Supabase command failed: ${arguments_.join(' ')}`)
  }
}
