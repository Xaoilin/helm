import { spawnSync } from 'node:child_process'
import process from 'node:process'

const timeoutMs = Number(process.env.HELM_DATABASE_WAIT_TIMEOUT_MS || 10 * 60 * 1000)
const intervalMs = Number(process.env.HELM_DATABASE_WAIT_INTERVAL_MS || 10_000)
const deadline = Date.now() + timeoutMs
let lastFailure = ''

while (Date.now() < deadline) {
  const result = spawnSync(process.execPath, ['./scripts/verify-helm-database.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  })
  if (result.status === 0) {
    process.stdout.write(result.stdout)
    process.exit(0)
  }
  lastFailure = `${result.stderr || result.stdout}`.trim()
  console.log('HELM database is not authoritative yet; waiting for the migration workflow.')
  await new Promise(resolve => setTimeout(resolve, intervalMs))
}

throw new Error(`Timed out waiting for the HELM database contract. Last failure:\n${lastFailure}`)
