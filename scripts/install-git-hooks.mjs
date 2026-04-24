import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hooksDir = resolve(rootDir, '.githooks')

if (!existsSync(hooksDir)) {
  throw new Error(`Cannot install git hooks because ${hooksDir} does not exist.`)
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: rootDir,
  stdio: 'inherit',
})

for (const hookName of ['pre-commit', 'pre-push']) {
  const hookPath = resolve(hooksDir, hookName)
  if (!existsSync(hookPath)) {
    throw new Error(`Expected git hook is missing: ${hookPath}`)
  }

  try {
    chmodSync(hookPath, 0o755)
  } catch (error) {
    console.warn(`Could not chmod ${hookName}; Git for Windows can still run it via core.hooksPath.`)
  }
}

console.log('Installed HELM git hooks from .githooks.')
