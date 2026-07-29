import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LOCAL_GIT_ENVIRONMENT_NAMES = execFileSync(
  'git',
  ['rev-parse', '--local-env-vars'],
  { encoding: 'utf8' },
).split(/\r?\n/u).filter(Boolean)

export function withoutLocalGitEnvironment(environment = process.env) {
  // Hooks export repository-local Git variables; cwd must select the target repo.
  const isolated = { ...environment }
  for (const name of LOCAL_GIT_ENVIRONMENT_NAMES) {
    delete isolated[name]
  }
  return isolated
}

const NATIVE_VERSION_FILES = new Set([
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
])

function git(rootDir, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      env: withoutLocalGitEnvironment(),
      stdio: ['ignore', 'pipe', allowFailure ? 'ignore' : 'pipe'],
    }).trim()
  } catch (error) {
    if (allowFailure) return ''
    throw error
  }
}

function lines(value) {
  return value
    .split(/\r?\n/u)
    .map(filePath => filePath.trim().replaceAll('\\', '/'))
    .filter(Boolean)
}

export function resolveComparisonBase(rootDir, preferred = 'origin/master') {
  const candidates = [preferred, 'master']
  for (const candidate of candidates) {
    if (git(rootDir, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], {
      allowFailure: true,
    })) {
      return candidate
    }
  }

  throw new Error(
    'Unable to find origin/master or master. Fetch the repository before running change-aware checks.',
  )
}

export function listChangedFiles(rootDir, preferredBase = 'origin/master') {
  const base = resolveComparisonBase(rootDir, preferredBase)
  const changed = new Set([
    ...lines(git(rootDir, [
      'diff',
      '--no-renames',
      '--name-only',
      '--diff-filter=ACMRD',
      `${base}...HEAD`,
    ])),
    ...lines(git(rootDir, ['diff', '--no-renames', '--name-only', '--diff-filter=ACMRD'])),
    ...lines(git(rootDir, [
      'diff',
      '--cached',
      '--no-renames',
      '--name-only',
      '--diff-filter=ACMRD',
    ])),
    ...lines(git(rootDir, ['ls-files', '--others', '--exclude-standard'])),
  ])

  return {
    base,
    files: [...changed].sort(),
  }
}

function normalizeNativeReleaseVersion(filePath, source) {
  const normalizedSource = source.replaceAll('\r\n', '\n')
  if (filePath === 'src-tauri/Cargo.toml') {
    return normalizedSource.replace(
      /(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/u,
      '$1"<release-version>"',
    )
  }
  if (filePath === 'src-tauri/Cargo.lock') {
    return normalizedSource.replace(
      /(\[\[package\]\]\nname\s*=\s*"helm"\nversion\s*=\s*)"[^"]+"/u,
      '$1"<release-version>"',
    )
  }
  if (filePath === 'src-tauri/tauri.conf.json') {
    return normalizedSource.replace(
      /("version"\s*:\s*)"[^"]+"/u,
      '$1"<release-version>"',
    )
  }
  return normalizedSource
}

function readFileAtRef(rootDir, ref, filePath) {
  try {
    return execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: rootDir,
      encoding: 'utf8',
      env: withoutLocalGitEnvironment(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

function normalizePackageVersion(filePath, source) {
  try {
    const parsed = JSON.parse(source)
    parsed.version = '<release-version>'
    if (filePath === 'package-lock.json' && parsed.packages?.['']) {
      parsed.packages[''].version = '<release-version>'
    }
    return JSON.stringify(parsed)
  } catch {
    return source
  }
}

function readContentStates(rootDir, filePath) {
  const currentPath = resolve(rootDir, filePath)
  return [
    readFileAtRef(rootDir, 'HEAD', filePath),
    readFileAtRef(rootDir, '', filePath),
    existsSync(currentPath) ? readFileSync(currentPath, 'utf8') : null,
  ]
}

function hasNormalizedImpact(rootDir, base, filePath, normalize) {
  const baseSource = readFileAtRef(rootDir, base, filePath)
  if (baseSource === null) return true

  return readContentStates(rootDir, filePath).some(source => (
    source === null || normalize(filePath, baseSource) !== normalize(filePath, source)
  ))
}

export function hasPackageRuntimeImpact(rootDir, base, files) {
  for (const filePath of files.filter(file => (
    file === 'package.json' || file === 'package-lock.json'
  ))) {
    if (hasNormalizedImpact(rootDir, base, filePath, normalizePackageVersion)) {
      return true
    }
  }
  return false
}

export function hasNativeImpact(rootDir, base, files, { includeWorkflow = false } = {}) {
  if (includeWorkflow && files.includes('.github/workflows/ci.yml')) return true

  const directNativeChange = files.some(filePath => (
    (
      filePath.startsWith('src-tauri/')
      || /^(?:Cargo\.toml|Cargo\.lock)$/u.test(filePath)
    )
    && !NATIVE_VERSION_FILES.has(filePath)
  ))
  if (directNativeChange) return true

  for (const filePath of files.filter(file => NATIVE_VERSION_FILES.has(file))) {
    if (hasNormalizedImpact(rootDir, base, filePath, normalizeNativeReleaseVersion)) {
      return true
    }
  }

  return false
}

export function classifyChanges(rootDir, files, base = null) {
  const existingFiles = files.filter(filePath => existsSync(resolve(rootDir, filePath)))
  const lintFiles = existingFiles.filter(filePath => /\.(?:[cm]?js|jsx|ts|tsx)$/u.test(filePath))
  const testInputs = existingFiles.filter(filePath => (
    /\.(?:[cm]?js|jsx|ts|tsx)$/u.test(filePath)
    && !filePath.startsWith('e2e/')
    && !filePath.startsWith('src-tauri/')
  ))

  const deletedTestInput = files.some(filePath => (
    /\.(?:[cm]?js|jsx|ts|tsx)$/u.test(filePath)
    && !filePath.startsWith('e2e/')
    && !filePath.startsWith('src-tauri/')
    && !existsSync(resolve(rootDir, filePath))
  ))
  const packageRuntimeImpact = base
    ? hasPackageRuntimeImpact(rootDir, base, files)
    : files.some(filePath => filePath === 'package.json' || filePath === 'package-lock.json')
  const globalTestChange = deletedTestInput || packageRuntimeImpact || files.some(filePath => (
    /^(?:vite\.config\.ts|tsconfig(?:\.[^.]+)?\.json)$/u.test(filePath)
    || filePath === 'src/test/setup.ts'
  ))
  const typecheck = files.some(filePath => (
    (
      filePath.startsWith('src/')
      && !filePath.startsWith('src/test/')
      && /\.(?:ts|tsx)$/u.test(filePath)
    )
    || /^(?:vite\.config\.ts|tsconfig(?:\.[^.]+)?\.json)$/u.test(filePath)
  )) || packageRuntimeImpact
  const ui = files.some(filePath => (
    (
      filePath.startsWith('src/')
      && !filePath.startsWith('src/test/')
      && /\.(?:tsx|css|scss|svg|png|jpe?g|webp)$/u.test(filePath)
    )
    || filePath.startsWith('public/')
    || filePath.startsWith('e2e/')
    || filePath === 'index.html'
    || filePath === 'playwright.config.ts'
    || filePath === 'scripts/run-playwright.mjs'
    || filePath === 'vite.config.ts'
    || packageRuntimeImpact
  ))
  const native = base
    ? hasNativeImpact(rootDir, base, files)
    : files.some(filePath => (
      filePath.startsWith('src-tauri/')
      || /^(?:Cargo\.toml|Cargo\.lock)$/u.test(filePath)
    ))

  return {
    globalTestChange,
    lintFiles,
    native,
    testInputs,
    typecheck,
    ui,
  }
}
