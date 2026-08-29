import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const supabaseCli = process.platform === 'win32'
  ? 'node_modules/.bin/supabase.cmd'
  : 'node_modules/.bin/supabase'
const concurrencyGateLockKey = 202608030293
const snapshotWriterLockKey = 202608030294

let failure = null
try {
  run(['db', 'reset', '--local', '--version', '20260501090000', '--no-seed'])
  runSqlFile('supabase/tests/fixtures/helm_legacy_accounts.sql')
  run(['migration', 'up', '--local'])
  run([
    'test', 'db', '--local',
    'supabase/tests/helm_database_authoritative.sql',
    'supabase/tests/helm_secret_vault.sql',
    'supabase/tests/sabah_one_inventory_oauth.sql',
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

  await runGatedPair(claims, [
    `select public.apply_helm_mutations(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      '[{"op":"create","collection":"tasks","recordId":"concurrent-a","payload":{"id":"concurrent-a","title":"A","completed":false}}]'::jsonb
    );`,
    `select public.apply_helm_mutations(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      '[{"op":"create","collection":"tasks","recordId":"concurrent-b","payload":{"id":"concurrent-b","title":"B","completed":false}}]'::jsonb
    );`,
  ])

  await runAuthenticatedMutation(claims, `
    select public.apply_helm_mutations(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
      '[{"op":"create","collection":"tasks","recordId":"shared-task","payload":{"id":"shared-task","title":"Original","completed":false}}]'::jsonb
    );
  `)

  await runGatedPair(claims, [
    `select public.apply_helm_mutations(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
      '[{"op":"patch","collection":"tasks","recordId":"shared-task","set":{"title":"Retitled"}}]'::jsonb
    );`,
    `select public.apply_helm_mutations(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc5',
      '[{"op":"patch","collection":"tasks","recordId":"shared-task","set":{"completed":true}}]'::jsonb
    );`,
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

  const beforeSnapshot = await runAuthenticatedSnapshot(claims)
  const snapshotWriterGate = await openAdvisoryGate(snapshotWriterLockKey)
  const snapshotWriter = startMarkedSql(`
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '${claims}', true);
    select public.apply_helm_mutations(
      'cccccccc-cccc-4ccc-8ccc-ccccccccccc6',
      '[{"op":"create","collection":"tasks","recordId":"snapshot-atomic","payload":{"id":"snapshot-atomic","title":"Atomic snapshot","completed":false}}]'::jsonb
    );
    select 'helm_snapshot_writer_ready';
    select pg_advisory_xact_lock(${snapshotWriterLockKey});
    commit;
  `, 'helm_snapshot_writer_ready')

  let duringSnapshot
  let samplingFailure = null
  try {
    await snapshotWriter.ready
    duringSnapshot = await runAuthenticatedSnapshot(claims)
  } catch (error) {
    samplingFailure = error
  } finally {
    await snapshotWriterGate.release()
  }
  await snapshotWriter.done
  if (samplingFailure) throw samplingFailure
  const afterSnapshot = await runAuthenticatedSnapshot(claims)

  const beforeVersion = beforeSnapshot.state?.accountVersion
  const duringVersion = duringSnapshot.state?.accountVersion
  const afterVersion = afterSnapshot.state?.accountVersion
  const duringIds = new Set((duringSnapshot.records || []).map(record => record.recordId))
  const afterIds = new Set((afterSnapshot.records || []).map(record => record.recordId))
  if (duringVersion !== beforeVersion || duringIds.has('snapshot-atomic')) {
    throw new Error('The atomic snapshot exposed part of an uncommitted write.')
  }
  if (afterVersion !== beforeVersion + 1 || !afterIds.has('snapshot-atomic')) {
    throw new Error('The atomic snapshot did not expose the complete committed write.')
  }
  if (afterSnapshot.records.length !== beforeSnapshot.records.length + 1) {
    throw new Error('The committed atomic snapshot was incomplete.')
  }

  console.log('Concurrent database sessions: 6 assertions passed')
}

async function runGatedPair(claims, statements) {
  const gate = await openAdvisoryGate(concurrencyGateLockKey)
  const sessions = statements.map(statement => startMarkedSql(`
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '${claims}', true);
    select 'helm_concurrency_session_ready';
    select pg_advisory_xact_lock(${concurrencyGateLockKey});
    ${statement}
    commit;
  `, 'helm_concurrency_session_ready'))

  let readinessFailure = null
  try {
    await Promise.all(sessions.map(session => session.ready))
  } catch (error) {
    readinessFailure = error
  } finally {
    await gate.release()
  }
  await Promise.all(sessions.map(session => session.done))
  if (readinessFailure) throw readinessFailure
}

async function runAuthenticatedSnapshot(claims) {
  const output = await runSqlOutput(`
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '${claims}', true);
    select public.get_helm_account_snapshot()::text;
    commit;
  `)
  const snapshot = output
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('{') && line.includes('"state"') && line.includes('"records"'))
  if (!snapshot) throw new Error('The atomic snapshot RPC did not return JSON.')
  return JSON.parse(snapshot)
}

function openAdvisoryGate(lockKey) {
  return new Promise((resolve, reject) => {
    const child = spawnPsql(['-qAt'])
    let output = ''
    let ready = false
    let released = false
    let exitError = null
    let finishExit
    const exited = new Promise(resolveExit => { finishExit = resolveExit })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk
      if (ready || !output.split('\n').includes('helm_advisory_gate_ready')) return
      ready = true
      resolve({
        release: async () => {
          if (!released) {
            released = true
            child.stdin.end(`select pg_advisory_unlock(${lockKey});\n`)
          }
          await exited
          if (exitError) throw exitError
        },
      })
    })
    child.once('error', error => {
      exitError = error
      finishExit()
      if (!ready) reject(error)
    })
    child.once('exit', code => {
      if (code !== 0) exitError = new Error(`Advisory-lock gate failed with exit code ${code}.`)
      finishExit()
      if (!ready) reject(exitError || new Error('Advisory-lock gate exited before it was ready.'))
    })
    child.stdin.write(`
      select pg_advisory_lock(${lockKey});
      select 'helm_advisory_gate_ready';
    `)
  })
}

function startMarkedSql(sql, marker) {
  const child = spawnPsql(['-qAt'])
  let output = ''
  let readySettled = false
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const done = new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk
      if (readySettled || !output.split('\n').includes(marker)) return
      readySettled = true
      resolveReady()
    })
    child.once('error', error => {
      if (!readySettled) {
        readySettled = true
        rejectReady(error)
      }
      reject(error)
    })
    child.once('exit', code => {
      if (!readySettled) {
        readySettled = true
        rejectReady(new Error(`Database session exited before marker ${marker}.`))
      }
      if (code === 0) resolve()
      else reject(new Error(`Database SQL failed with exit code ${code}.`))
    })
    child.stdin.end(sql)
  })
  return { ready, done }
}

async function runAuthenticatedMutation(claims, sql) {
  await runSql(`
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '${claims}', true);
    ${sql}
    commit;
  `)
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawnPsql(['-q'])
    child.stdout.resume()
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`Database SQL failed with exit code ${code}.`))
    })
    child.stdin.end(sql)
  })
}

function runSqlOutput(sql) {
  return new Promise((resolve, reject) => {
    const child = spawnPsql(['-qAt'])
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve(output)
      else reject(new Error(`Database SQL failed with exit code ${code}.`))
    })
    child.stdin.end(sql)
  })
}

function spawnPsql(extraArguments) {
  return spawn(
    'docker',
    ['exec', '-i', 'supabase_db_helm', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...extraArguments],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )
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
