// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyChanges,
  hasNativeImpact,
  hasPackageRuntimeImpact,
  listChangedFiles,
} from '../../scripts/lib/changedFiles.mjs'

describe('agent workflow change classification', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'helm-agent-workflow-'))

  afterAll(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('selects focused web checks without native tests', () => {
    mkdirSync(join(rootDir, 'src'), { recursive: true })
    writeFileSync(join(rootDir, 'src', 'App.tsx'), 'export {}')

    expect(classifyChanges(rootDir, ['src/App.tsx'])).toMatchObject({
      lintFiles: ['src/App.tsx'],
      native: false,
      typecheck: true,
      ui: true,
    })
    expect(classifyChanges(rootDir, ['index.html']).ui).toBe(true)
    expect(classifyChanges(rootDir, ['src/assets/logo.svg']).ui).toBe(true)
    expect(classifyChanges(rootDir, ['scripts/run-playwright.mjs']).ui).toBe(true)
    expect(classifyChanges(rootDir, ['vite.config.ts']).ui).toBe(true)
  })

  it('selects native tests only for native source or Cargo changes', () => {
    expect(classifyChanges(rootDir, [
      'docs/engineering-guide.md',
      '.github/workflows/ci.yml',
    ]).native).toBe(false)
    expect(classifyChanges(rootDir, ['src-tauri/src/lib.rs']).native).toBe(true)
    expect(classifyChanges(rootDir, ['src-tauri/Cargo.lock']).native).toBe(true)
  })

  it('treats central test configuration as a full-unit-suite change', () => {
    expect(classifyChanges(rootDir, ['vite.config.ts']).globalTestChange).toBe(true)
    expect(classifyChanges(rootDir, ['src/test/setup.ts']).globalTestChange).toBe(true)
    expect(classifyChanges(rootDir, ['src/test/setup.ts']).typecheck).toBe(false)
  })

  it('ignores synchronized release-only native metadata changes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'helm-native-impact-'))
    mkdirSync(join(repo, 'src-tauri'), { recursive: true })
    writeFileSync(join(repo, 'src-tauri', 'Cargo.toml'), '[package]\nname = "helm"\nversion = "0.2.71"\n')
    writeFileSync(
      join(repo, 'src-tauri', 'Cargo.lock'),
      'version = 4\n\n[[package]]\nname = "helm"\nversion = "0.2.71"\n',
    )
    writeFileSync(join(repo, 'src-tauri', 'tauri.conf.json'), '{"version":"0.2.71"}\n')
    execFileSync('git', ['init', '-b', 'master'], { cwd: repo })
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', [
      '-c',
      'user.name=HELM Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'base',
    ], { cwd: repo })

    writeFileSync(join(repo, 'src-tauri', 'Cargo.toml'), '[package]\nname = "helm"\nversion = "0.2.72"\n')
    writeFileSync(
      join(repo, 'src-tauri', 'Cargo.lock'),
      'version = 4\n\n[[package]]\nname = "helm"\nversion = "0.2.72"\n',
    )
    writeFileSync(join(repo, 'src-tauri', 'tauri.conf.json'), '{"version":"0.2.72"}\n')

    const releaseFiles = [
      'src-tauri/Cargo.lock',
      'src-tauri/Cargo.toml',
      'src-tauri/tauri.conf.json',
    ]
    expect(hasNativeImpact(repo, 'HEAD', releaseFiles)).toBe(false)

    writeFileSync(
      join(repo, 'src-tauri', 'Cargo.toml'),
      '[package]\nname = "helm"\nversion = "0.2.72"\n\n[dependencies]\nserde = "1"\n',
    )
    expect(hasNativeImpact(repo, 'HEAD', releaseFiles)).toBe(true)
    rmSync(repo, { recursive: true, force: true })
  })

  it('keeps staged native impact when the worktree hides it', () => {
    const repo = mkdtempSync(join(tmpdir(), 'helm-staged-native-impact-'))
    mkdirSync(join(repo, 'src-tauri'), { recursive: true })
    const baseCargo = '[package]\nname = "helm"\nversion = "0.2.71"\n'
    writeFileSync(join(repo, 'src-tauri', 'Cargo.toml'), baseCargo)
    execFileSync('git', ['init', '-b', 'master'], { cwd: repo })
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', [
      '-c',
      'user.name=HELM Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'base',
    ], { cwd: repo })

    writeFileSync(
      join(repo, 'src-tauri', 'Cargo.toml'),
      `${baseCargo}\n[dependencies]\nserde = "1"\n`,
    )
    execFileSync('git', ['add', 'src-tauri/Cargo.toml'], { cwd: repo })
    writeFileSync(
      join(repo, 'src-tauri', 'Cargo.toml'),
      '[package]\r\nname = "helm"\r\nversion = "0.2.72"\r\n',
    )

    expect(hasNativeImpact(repo, 'HEAD', ['src-tauri/Cargo.toml'])).toBe(true)
    rmSync(repo, { recursive: true, force: true })
  })

  it('ignores release-only package metadata changes but catches script changes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'helm-package-impact-'))
    writeFileSync(join(repo, 'package.json'), '{"name":"helm","version":"0.2.71","scripts":{"test":"vitest"}}\n')
    writeFileSync(
      join(repo, 'package-lock.json'),
      '{"name":"helm","version":"0.2.71","lockfileVersion":3,"packages":{"":{"version":"0.2.71"}}}\n',
    )
    execFileSync('git', ['init', '-b', 'master'], { cwd: repo })
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', [
      '-c',
      'user.name=HELM Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'base',
    ], { cwd: repo })

    writeFileSync(join(repo, 'package.json'), '{"name":"helm","version":"0.2.72","scripts":{"test":"vitest"}}\n')
    writeFileSync(
      join(repo, 'package-lock.json'),
      '{"name":"helm","version":"0.2.72","lockfileVersion":3,"packages":{"":{"version":"0.2.72"}}}\n',
    )
    const files = ['package-lock.json', 'package.json']
    expect(hasPackageRuntimeImpact(repo, 'HEAD', files)).toBe(false)

    writeFileSync(
      join(repo, 'package.json'),
      '{"name":"helm","version":"0.2.72","scripts":{"test":"vitest run"}}\n',
    )
    expect(hasPackageRuntimeImpact(repo, 'HEAD', files)).toBe(true)
    rmSync(repo, { recursive: true, force: true })
  })

  it('unions branch, staged, unstaged, and untracked changes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'helm-changed-files-'))
    execFileSync('git', ['init', '-b', 'master'], { cwd: repo })
    for (const fileName of ['branch.ts', 'staged.ts', 'unstaged.ts']) {
      writeFileSync(join(repo, fileName), 'export const value = 1\n')
    }
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', [
      '-c',
      'user.name=HELM Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'base',
    ], { cwd: repo })
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['update-ref', 'refs/remotes/origin/master', baseSha], { cwd: repo })
    execFileSync('git', ['switch', '-c', 'codex/test'], {
      cwd: repo,
      stdio: 'ignore',
    })

    writeFileSync(join(repo, 'branch.ts'), 'export const value = 2\n')
    execFileSync('git', ['add', 'branch.ts'], { cwd: repo })
    execFileSync('git', [
      '-c',
      'user.name=HELM Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'branch',
    ], { cwd: repo })
    writeFileSync(join(repo, 'staged.ts'), 'export const value = 2\n')
    execFileSync('git', ['add', 'staged.ts'], { cwd: repo })
    writeFileSync(join(repo, 'unstaged.ts'), 'export const value = 2\n')
    writeFileSync(join(repo, 'untracked.ts'), 'export const value = 1\n')

    expect(listChangedFiles(repo)).toEqual({
      base: 'origin/master',
      files: ['branch.ts', 'staged.ts', 'unstaged.ts', 'untracked.ts'],
    })
    rmSync(repo, { recursive: true, force: true })
  })

  it('keeps both sides of a rename so native removals cannot be hidden', () => {
    const repo = mkdtempSync(join(tmpdir(), 'helm-native-rename-'))
    mkdirSync(join(repo, 'src-tauri', 'src'), { recursive: true })
    writeFileSync(join(repo, 'src-tauri', 'src', 'command.rs'), 'pub fn command() {}\n')
    execFileSync('git', ['init', '-b', 'master'], { cwd: repo })
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', [
      '-c',
      'user.name=HELM Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'base',
    ], { cwd: repo })
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    execFileSync('git', ['update-ref', 'refs/remotes/origin/master', baseSha], { cwd: repo })
    mkdirSync(join(repo, 'archive'), { recursive: true })
    execFileSync('git', ['mv', 'src-tauri/src/command.rs', 'archive/command.rs'], { cwd: repo })

    const selection = listChangedFiles(repo)
    expect(selection.files).toEqual([
      'archive/command.rs',
      'src-tauri/src/command.rs',
    ])
    expect(hasNativeImpact(repo, selection.base, selection.files)).toBe(true)
    rmSync(repo, { recursive: true, force: true })
  })
})
