import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const supabaseCli = process.platform === 'win32'
  ? 'node_modules/.bin/supabase.cmd'
  : 'node_modules/.bin/supabase'

let failure = null
try {
  run(['db', 'reset', '--local', '--version', '20260501090000', '--no-seed'])
  runSqlFile('supabase/tests/fixtures/helm_legacy_accounts.sql')
  run(['migration', 'up', '--local'])
  run([
    'test', 'db', '--local',
    'supabase/tests/helm_database_authoritative.sql',
    'supabase/tests/helm_legacy_migration.sql',
  ])
  await runConcurrencyScenario()
} catch (error) {
  failure = error
} finally {
  try {
    run(['db', 'reset', '--local', '--no-seed'])
  } catch (resetError) {
    if (!failure) failure = resetError
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

async function runConcurrencyScenario() {
  const userId = '55555555-5555-4555-8555-555555555555'
  const claims = JSON.stringify({
    sub: userId,
    role: 'authenticated',
    is_anonymous: false,
  })

  await runSql(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '${userId}',
      'authenticated', 'authenticated', 'helm-concurrency@example.test', '', now(), now()
    );
  `)

  await Promise.all([
    runAuthenticatedMutation(claims, `
      select public.apply_helm_mutations(
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        '[{"op":"create","collection":"tasks","recordId":"concurrent-a","payload":{"id":"concurrent-a","title":"A","completed":false}}]'::jsonb
      );
    `),
    runAuthenticatedMutation(claims, `
      select public.apply_helm_mutations(
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
        '[{"op":"create","collection":"tasks","recordId":"concurrent-b","payload":{"id":"concurrent-b","title":"B","completed":false}}]'::jsonb
      );
    `),
  ])

  await runAuthenticatedMutation(claims, `
    select public.apply_helm_mutations(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      '[{"op":"create","collection":"tasks","recordId":"shared-task","payload":{"id":"shared-task","title":"Original","completed":false}}]'::jsonb
    );
  `)

  await Promise.all([
    runAuthenticatedMutation(claims, `
      select public.apply_helm_mutations(
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
        '[{"op":"patch","collection":"tasks","recordId":"shared-task","set":{"title":"Retitled"}}]'::jsonb
      );
    `),
    runAuthenticatedMutation(claims, `
      select public.apply_helm_mutations(
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc5',
        '[{"op":"patch","collection":"tasks","recordId":"shared-task","set":{"completed":true}}]'::jsonb
      );
    `),
  ])

  await runSql(`
    do $$
    begin
      if (
        select count(*)
        from public.helm_records
        where user_id = '${userId}'
          and collection = 'tasks'
          and record_id in ('concurrent-a', 'concurrent-b')
          and deleted_at is null
      ) <> 2 then
        raise exception 'Concurrent additions did not both survive.';
      end if;

      if not exists (
        select 1
        from public.helm_records
        where user_id = '${userId}'
          and collection = 'tasks'
          and record_id = 'shared-task'
          and payload ->> 'title' = 'Retitled'
          and (payload ->> 'completed')::boolean
          and revision = 3
      ) then
        raise exception 'Concurrent independent patches did not both survive.';
      end if;

      if (
        select account_version
        from public.helm_account_state
        where user_id = '${userId}'
      ) <> 5 then
        raise exception 'Concurrent requests did not receive distinct account versions.';
      end if;
    end
    $$;
  `)

  console.log('Concurrent database sessions: 3 assertions passed')
}

async function runAuthenticatedMutation(claims, sql) {
  await runSql(`
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '${claims}', true);
    select pg_sleep(0.1);
    ${sql}
    commit;
  `)
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', '-i', 'supabase_db_helm', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['pipe', 'ignore', 'inherit'],
      },
    )
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Concurrent database SQL failed with exit code ${code}.`))
    })
    child.stdin.end(sql)
  })
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
