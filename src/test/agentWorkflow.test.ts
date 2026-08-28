// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyChanges,
  hasPackageRuntimeImpact,
  listChangedFiles,
  withoutLocalGitEnvironment,
} from '../../scripts/lib/changedFiles.mjs'
import {
  evaluateHostedWebCompatibilityJob,
  findForbiddenHostedWebDependencies,
  findForbiddenHostedWebPackageScripts,
  findForbiddenHostedWebPolicyInText,
} from '../../scripts/lib/agentPolicy.mjs'

const temporaryGitEnvironment = withoutLocalGitEnvironment()

function runTemporaryGit(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: temporaryGitEnvironment,
  })
}

describe('agent workflow change classification', () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'helm-agent-workflow-'))

  afterAll(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('isolates temporary repositories from Git hook repository variables', () => {
    expect(withoutLocalGitEnvironment({
      GIT_COMMON_DIR: '/real/repository/common',
      GIT_DIR: '/real/repository/git-dir',
      GIT_WORK_TREE: '/real/repository/worktree',
      PATH: process.env.PATH,
    })).toEqual({
      PATH: process.env.PATH,
    })
  })

  it('selects focused web checks', () => {
    mkdirSync(join(rootDir, 'src'), { recursive: true })
    writeFileSync(join(rootDir, 'src', 'App.tsx'), 'export {}')

    expect(classifyChanges(rootDir, ['src/App.tsx'])).toMatchObject({
      lintFiles: ['src/App.tsx'],
      typecheck: true,
      ui: true,
    })
    expect(classifyChanges(rootDir, ['index.html']).ui).toBe(true)
    expect(classifyChanges(rootDir, ['src/assets/logo.svg']).ui).toBe(true)
    expect(classifyChanges(rootDir, ['scripts/run-playwright.mjs']).ui).toBe(true)
    expect(classifyChanges(rootDir, ['vite.config.ts']).ui).toBe(true)
  })

  it('treats central test configuration as a full-unit-suite change', () => {
    expect(classifyChanges(rootDir, ['vite.config.ts']).globalTestChange).toBe(true)
    expect(classifyChanges(rootDir, ['src/test/setup.ts']).globalTestChange).toBe(true)
    expect(classifyChanges(rootDir, ['src/test/setup.ts']).typecheck).toBe(false)
  })

  it('ignores release-only package metadata changes but catches script changes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'helm-package-impact-'))
    writeFileSync(join(repo, 'package.json'), '{"name":"helm","version":"0.2.71","scripts":{"test":"vitest"}}\n')
    writeFileSync(
      join(repo, 'package-lock.json'),
      '{"name":"helm","version":"0.2.71","lockfileVersion":3,"packages":{"":{"version":"0.2.71"}}}\n',
    )
    runTemporaryGit(repo, ['init', '-b', 'master'])
    runTemporaryGit(repo, ['add', '.'])
    runTemporaryGit(repo, [
      '-c',
      'user.name=Sabah One Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'base',
    ])

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
    runTemporaryGit(repo, ['init', '-b', 'master'])
    for (const fileName of ['branch.ts', 'staged.ts', 'unstaged.ts']) {
      writeFileSync(join(repo, fileName), 'export const value = 1\n')
    }
    runTemporaryGit(repo, ['add', '.'])
    runTemporaryGit(repo, [
      '-c',
      'user.name=Sabah One Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'base',
    ])
    const baseSha = runTemporaryGit(repo, ['rev-parse', 'HEAD']).trim()
    runTemporaryGit(repo, ['update-ref', 'refs/remotes/origin/master', baseSha])
    runTemporaryGit(repo, ['switch', '-c', 'codex/test'])

    writeFileSync(join(repo, 'branch.ts'), 'export const value = 2\n')
    runTemporaryGit(repo, ['add', 'branch.ts'])
    runTemporaryGit(repo, [
      '-c',
      'user.name=Sabah One Test',
      '-c',
      'user.email=helm@example.invalid',
      'commit',
      '-m',
      'branch',
    ])
    writeFileSync(join(repo, 'staged.ts'), 'export const value = 2\n')
    runTemporaryGit(repo, ['add', 'staged.ts'])
    writeFileSync(join(repo, 'unstaged.ts'), 'export const value = 2\n')
    writeFileSync(join(repo, 'untracked.ts'), 'export const value = 1\n')

    expect(listChangedFiles(repo)).toEqual({
      base: 'origin/master',
      files: ['branch.ts', 'staged.ts', 'unstaged.ts', 'untracked.ts'],
    })
    rmSync(repo, { recursive: true, force: true })
  })

  it('guards native reintroduction while allowing benign project metadata and web wording', () => {
    const forbiddenPackage = '@' + 't' + 'auri-apps/api'
    const sabahOne = ['Sabah', 'One'].join(' ')
    const desktopApp = ['desktop', 'app'].join(' ')
    const localProjectFolders = ['local', 'project', 'folders'].join(' ')
    const projectDirectoryApi = ['pick', 'ProjectDirectory'].join('')

    expect(findForbiddenHostedWebPolicyInText(
      'src/App.tsx',
      `import { invoke } from '${forbiddenPackage}'`,
      'source',
    )).toHaveLength(1)
    expect(findForbiddenHostedWebPolicyInText(
      '.github/workflows/ci.yml',
      'run: cargo test',
      'ci',
    )).toHaveLength(1)
    expect(findForbiddenHostedWebPolicyInText(
      'README.md',
      'External projects may use the desktop_app catalogue kind, desktop app alternatives, browser-native APIs, and unrelated local providers.',
      'docs',
    )).toEqual([])
    expect(findForbiddenHostedWebPolicyInText(
      'src/components/projects/ProjectCatalog.tsx',
      "const kind = 'desktop_app'; const provider = 'local';",
      'source',
    )).toEqual([])
    expect(findForbiddenHostedWebPolicyInText(
      'src/Settings.tsx',
      `${sabahOne} ${desktopApp} supports ${localProjectFolders}.`,
      'source',
    )).toHaveLength(1)
    expect(findForbiddenHostedWebPolicyInText(
      'src/Projects.tsx',
      `const path = await ${projectDirectoryApi}();`,
      'source',
    )).toHaveLength(1)
    expect(findForbiddenHostedWebPolicyInText(
      'AGENTS.md',
      `${sabahOne} ${desktopApp} support is removed.`,
    )).toHaveLength(1)
    expect(findForbiddenHostedWebPolicyInText(
      '.github/workflows/ci.yml',
      '- uses: actions/cache@v4\n  with:\n    path: ~/.npm\n    key: web-dependencies-${{ hashFiles(\'package-lock.json\') }}',
      'ci',
    )).toEqual([])
    expect(findForbiddenHostedWebPolicyInText(
      '.github/workflows/ci.yml',
      '- uses: actions/cache@v4\n  with:\n    path: ~/.cargo\n    key: native-cargo-${{ runner.os }}',
      'ci',
    ).length).toBeGreaterThan(0)
    expect(evaluateHostedWebCompatibilityJob(`  native:\n    name: native\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hosted-web-compatibility`)).toMatchObject({ ok: true })
    expect(evaluateHostedWebCompatibilityJob(`  native:\n    name: native\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/cache@v4\n        with:\n          path: ~/.cargo\n      - run: npm run test:native`)).toMatchObject({ ok: false })
    expect(findForbiddenHostedWebDependencies(
      { dependencies: { [forbiddenPackage]: '2.10.1' } },
      { packages: { [`node_modules/${forbiddenPackage}`]: {} } },
    )).toHaveLength(2)
    expect(findForbiddenHostedWebPackageScripts({
      scripts: { native: 'cargo test' },
    })).toHaveLength(1)
  })
})
