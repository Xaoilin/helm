// @vitest-environment node
import {
  buildGitHubPagesUrl,
  evaluateHandoffVerification,
  findSuccessfulRunForHead,
  isIgnoredWorkingTreePath,
  parseBranchList,
  parseGitHubRemoteUrl,
  parseStatusPaths,
} from '../../scripts/lib/handoffVerification.mjs'

describe('handoffVerification helpers', () => {
  it('parses GitHub remotes and builds the Pages URL', () => {
    expect(parseGitHubRemoteUrl('git@github.com:Xaoilin/helm.git')).toEqual({
      owner: 'Xaoilin',
      repo: 'helm',
    })

    expect(parseGitHubRemoteUrl('https://github.com/Xaoilin/helm.git')).toEqual({
      owner: 'Xaoilin',
      repo: 'helm',
    })

    expect(buildGitHubPagesUrl({ owner: 'Xaoilin', repo: 'helm' })).toBe('https://xaoilin.github.io/helm/')
  })

  it('finds the successful workflow run for the deployed head', () => {
    const runs = [
      {
        conclusion: 'failure',
        headSha: 'older',
        status: 'completed',
        url: 'https://example.com/failure',
      },
      {
        conclusion: 'success',
        headSha: 'target',
        status: 'completed',
        url: 'https://example.com/success',
      },
    ]

    expect(findSuccessfulRunForHead(runs, 'target')).toEqual(runs[1])
    expect(findSuccessfulRunForHead(runs, 'missing')).toBeNull()
  })

  it('flags branch-only work, stale topic branches, and a stale live bundle', () => {
    const result = evaluateHandoffVerification({
      assetUrl: 'https://xaoilin.github.io/helm/assets/index-old.js',
      blockingWorkingTreeChanges: ['src/App.tsx'],
      ciRun: null,
      currentBranch: 'codex/topic',
      currentHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      isHeadMergedIntoMaster: false,
      liveSiteContainsVersion: false,
      masterHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedLocalTopicBranches: ['codex/topic'],
      mergedRemoteTopicBranches: ['origin/codex/topic'],
      pagesRun: null,
      pagesUrl: 'https://xaoilin.github.io/helm/',
      supabaseRun: null,
      version: '0.2.1',
    })

    expect(result.ok).toBe(false)
    expect(result.failures).toContain(
      'Working tree still has uncommitted non-generated changes: src/App.tsx.',
    )
    expect(result.failures).toContain(
      'Current HEAD aaaaaaa is not merged into origin/master bbbbbbb.',
    )
    expect(result.failures).toContain(
      'No successful CI run was found for origin/master at bbbbbbb.',
    )
    expect(result.failures).toContain(
      'Merged local topic branches still exist: codex/topic.',
    )
    expect(result.failures).toContain(
      'Merged remote topic branches still exist: origin/codex/topic.',
    )
  })

  it('passes a fully verified release state', () => {
    const successRun = {
      conclusion: 'success',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'completed',
      url: 'https://github.com/Xaoilin/helm/actions/runs/123',
    }

    const result = evaluateHandoffVerification({
      assetUrl: 'https://xaoilin.github.io/helm/assets/index-new.js',
      blockingWorkingTreeChanges: [],
      ciRun: successRun,
      currentBranch: 'master',
      currentHead: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      isHeadMergedIntoMaster: true,
      liveSiteContainsVersion: true,
      masterHead: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedLocalTopicBranches: [],
      mergedRemoteTopicBranches: [],
      pagesRun: successRun,
      pagesUrl: 'https://xaoilin.github.io/helm/',
      supabaseRun: successRun,
      version: '0.2.1',
    })

    expect(result.ok).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.passes).toContain('No merged local codex branches remain.')
  })

  it('parses git branch output into clean branch names', () => {
    expect(parseBranchList(' codex/one \n\norigin/codex/two\r\n')).toEqual([
      'codex/one',
      'origin/codex/two',
    ])
  })

  it('parses git status paths and ignores generated artifacts', () => {
    expect(
      parseStatusPaths(' M README.md\n?? .codex/runlogs/log.txt\nR  docs/old.md -> docs/new.md\n'),
    ).toEqual([
      'README.md',
      '.codex/runlogs/log.txt',
      'docs/new.md',
    ])

    expect(isIgnoredWorkingTreePath('.codex/runlogs/log.txt')).toBe(true)
    expect(isIgnoredWorkingTreePath('test-results/manual-proof.png')).toBe(true)
    expect(isIgnoredWorkingTreePath('src/App.tsx')).toBe(false)
  })
})
