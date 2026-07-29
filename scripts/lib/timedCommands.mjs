import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'

const npmCli = process.env.npm_execpath
const npmCommand = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm')
const activeChildren = new Set()
const escalationTimers = new Map()
let terminatingSignal = null

function signalExitCode(signal) {
  if (signal === 'SIGINT') return 130
  if (signal === 'SIGTERM') return 143
  return 1
}

function signalChildTree(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return

  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    taskkill.once('error', () => {})
    taskkill.unref()
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // The process already exited between the status check and signal.
    }
  }

  if (signal !== 'SIGKILL' && !escalationTimers.has(child)) {
    const timer = setTimeout(() => signalChildTree(child, 'SIGKILL'), 3_000)
    timer.unref()
    escalationTimers.set(child, timer)
  }
}

function forwardTermination(signal) {
  const force = terminatingSignal !== null
  terminatingSignal ??= signal
  process.exitCode = signalExitCode(terminatingSignal)

  for (const child of activeChildren) {
    signalChildTree(child, force ? 'SIGKILL' : signal)
  }
}

process.on('SIGINT', () => forwardTermination('SIGINT'))
process.on('SIGTERM', () => forwardTermination('SIGTERM'))

export function npmRun(script, extraArgs = [], options = {}) {
  return {
    args: [
      ...(npmCli ? [npmCli] : []),
      'run',
      script,
      ...(extraArgs.length > 0 ? ['--', ...extraArgs] : []),
    ],
    command: npmCommand,
    label: script,
    ...options,
  }
}

export async function runTimed(commandSpec) {
  const startedAt = performance.now()
  const { args = [], command, env, label } = commandSpec
  console.log(`\n▶ ${label}`)

  const execution = await new Promise(resolvePromise => {
    let child
    let settled = false

    const finish = (exitCode, error = null) => {
      if (settled) return
      settled = true
      if (child) {
        activeChildren.delete(child)
        const timer = escalationTimers.get(child)
        if (timer) clearTimeout(timer)
        escalationTimers.delete(child)
      }
      resolvePromise({ error, exitCode })
    }

    try {
      child = spawn(command, args, {
        detached: process.platform !== 'win32',
        env: { ...process.env, ...env },
        shell: false,
        stdio: 'inherit',
      })
      activeChildren.add(child)
      child.once('error', error => finish(1, error))
      child.once('exit', (code, signal) => finish(
        code ?? signalExitCode(signal ?? terminatingSignal),
      ))
      if (terminatingSignal) signalChildTree(child, terminatingSignal)
    } catch (error) {
      finish(1, error)
    }
  })
  const durationMs = Math.round(performance.now() - startedAt)
  const result = {
    durationMs,
    exitCode: execution.exitCode,
    label,
    ...(execution.error ? { error: execution.error.message } : {}),
  }
  if (execution.error) console.error(`${label}: ${execution.error.message}`)
  console.log(
    `${execution.exitCode === 0 ? '✓' : '✗'} ${label} (${(durationMs / 1000).toFixed(2)}s)`,
  )
  return result
}

export async function runGroup(commandSpecs) {
  const results = await Promise.all(commandSpecs.map(runTimed))
  const failed = results.filter(result => result.exitCode !== 0)
  if (failed.length > 0) {
    const error = new Error(`Checks failed: ${failed.map(result => result.label).join(', ')}`)
    error.results = results
    throw error
  }
  return results
}

export async function writeTimingReport(filePath, report) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

export function printTimingSummary(results, totalDurationMs) {
  console.log('\nTiming summary')
  for (const result of results) {
    const state = result.exitCode === 0 ? 'passed' : result.exitCode === null ? 'skipped' : 'failed'
    const timing = result.durationMs === null ? '' : ` in ${(result.durationMs / 1000).toFixed(2)}s`
    console.log(`- ${result.label}: ${state}${timing}`)
  }
  console.log(`- total wall time: ${(totalDurationMs / 1000).toFixed(2)}s`)
}
