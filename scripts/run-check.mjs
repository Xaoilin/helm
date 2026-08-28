import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import {
  npmRun,
  printTimingSummary,
  runGroup,
  runTimed,
  writeTimingReport,
} from './lib/timedCommands.mjs'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const reportPath = resolve(rootDir, 'test-results', 'check', 'timings.json')
const startedAt = performance.now()
const results = []
let failed = false

const policy = await runTimed(npmRun('agent:policy'))
results.push(policy)
if (policy.exitCode !== 0) {
  failed = true
} else {
  const checks = [
    npmRun('lint'),
    npmRun('typecheck'),
    npmRun('test'),
    npmRun('build:web'),
    npmRun('test:e2e'),
  ]

  try {
    results.push(...await runGroup(checks))
  } catch (error) {
    results.push(...(error.results ?? []))
    failed = true
  }
}

const totalDurationMs = Math.round(performance.now() - startedAt)
printTimingSummary(results, totalDurationMs)
await writeTimingReport(reportPath, {
  results,
  totalDurationMs,
})

if (failed && !process.exitCode) process.exitCode = 1
