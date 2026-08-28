import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { classifyChanges, listChangedFiles } from './lib/changedFiles.mjs'
import {
  npmRun,
  printTimingSummary,
  runGroup,
  runTimed,
  writeTimingReport,
} from './lib/timedCommands.mjs'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const reportPath = resolve(rootDir, 'test-results', 'agent-fast', 'timings.json')
const startedAt = performance.now()
const selection = listChangedFiles(rootDir)
const impact = classifyChanges(rootDir, selection.files, selection.base)
const results = []

console.log(`Fast agent validation against ${selection.base}`)
if (selection.files.length === 0) {
  console.log('Changed files: none')
} else {
  const visibleFiles = selection.files.slice(0, 30)
  const remainder = selection.files.length - visibleFiles.length
  console.log(
    `Changed files (${selection.files.length}):\n`
    + visibleFiles.map(file => `- ${file}`).join('\n')
    + (remainder > 0
      ? `\n- … ${remainder} more (full list is in ${reportPath})`
      : ''),
  )
}

const policyResult = await runTimed(npmRun('agent:policy'))
results.push(policyResult)
if (policyResult.exitCode !== 0) {
  const totalDurationMs = Math.round(performance.now() - startedAt)
  printTimingSummary(results, totalDurationMs)
  await writeTimingReport(reportPath, {
    base: selection.base,
    changedFiles: selection.files,
    impact,
    results,
    totalDurationMs,
  })
  if (!process.exitCode) process.exitCode = 1
} else {
  const selected = []

  if (impact.lintFiles.length > 0) {
    selected.push(npmRun('lint:changed', impact.lintFiles, { label: 'changed-file lint' }))
  }
  if (impact.typecheck) selected.push(npmRun('typecheck', [], { label: 'incremental typecheck' }))
  if (impact.globalTestChange) {
    selected.push(npmRun('test', [], { label: 'unit tests (global config changed)' }))
  } else if (impact.testInputs.length > 0) {
    selected.push(npmRun('test:related', impact.testInputs, { label: 'related unit tests' }))
  }
  if (impact.ui) selected.push(npmRun('test:e2e:smoke', [], { label: 'UI smoke tests' }))
  const selectedLabels = new Set(selected.map(item => item.label))
  for (const label of [
    'changed-file lint',
    'incremental typecheck',
    'related unit tests',
    'unit tests (global config changed)',
    'UI smoke tests',
  ]) {
    if (!selectedLabels.has(label)) {
      results.push({ durationMs: null, exitCode: null, label })
    }
  }

  try {
    if (selected.length > 0) results.push(...await runGroup(selected))
  } catch (error) {
    results.push(...(error.results ?? []))
    if (!process.exitCode) process.exitCode = 1
  }

  const totalDurationMs = Math.round(performance.now() - startedAt)
  results.sort((left, right) => left.label.localeCompare(right.label))
  printTimingSummary(results, totalDurationMs)
  await mkdir(resolve(rootDir, 'test-results', 'agent-fast'), { recursive: true })
  await writeTimingReport(reportPath, {
    base: selection.base,
    changedFiles: selection.files,
    impact,
    results,
    totalDurationMs,
  })
}
