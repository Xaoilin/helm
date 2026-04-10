export function parseGitHubRemoteUrl(remoteUrl) {
  const normalized = remoteUrl.trim()
  const sshMatch = normalized.match(/^git@github\.com:(?<owner>[^/]+)\/(?<repo>.+?)(?:\.git)?$/)
  if (sshMatch?.groups) {
    return {
      owner: sshMatch.groups.owner,
      repo: sshMatch.groups.repo,
    }
  }

  const httpsMatch = normalized.match(/^https:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>.+?)(?:\.git)?$/)
  if (httpsMatch?.groups) {
    return {
      owner: httpsMatch.groups.owner,
      repo: httpsMatch.groups.repo,
    }
  }

  throw new Error(`Unsupported GitHub remote URL: ${remoteUrl}`)
}

export function buildGitHubPagesUrl({ owner, repo }) {
  return `https://${owner.toLowerCase()}.github.io/${repo}/`
}

export function parseBranchList(rawOutput) {
  return rawOutput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function parseStatusPaths(rawOutput) {
  return rawOutput
    .split(/\r?\n/u)
    .map((line) => {
      if (!line.trim()) {
        return null
      }

      const pathSegment = line.slice(3)
      const renamedParts = pathSegment.split(' -> ')
      return renamedParts[renamedParts.length - 1]?.trim() ?? null
    })
    .filter(Boolean)
}

export function isIgnoredWorkingTreePath(path) {
  return (
    path.startsWith('.codex/') ||
    path.startsWith('supabase/.temp/') ||
    path.startsWith('test-results/')
  )
}

export function findSuccessfulRunForHead(runs, headSha) {
  return runs.find(
    (run) => run.headSha === headSha && run.status === 'completed' && run.conclusion === 'success',
  ) ?? null
}

export function evaluateHandoffVerification(state) {
  const failures = []
  const passes = []

  if (state.blockingWorkingTreeChanges.length > 0) {
    failures.push(
      `Working tree still has uncommitted non-generated changes: ${state.blockingWorkingTreeChanges.join(', ')}.`,
    )
  } else {
    passes.push('No uncommitted non-generated working tree changes remain.')
  }

  if (!state.isHeadMergedIntoMaster) {
    failures.push(
      `Current HEAD ${state.currentHead.slice(0, 7)} is not merged into origin/master ${state.masterHead.slice(0, 7)}.`,
    )
  } else {
    passes.push(`Current HEAD is merged into origin/master at ${state.masterHead.slice(0, 7)}.`)
  }

  if (!state.ciRun) {
    failures.push(`No successful CI run was found for origin/master at ${state.masterHead.slice(0, 7)}.`)
  } else {
    passes.push(`CI passed for origin/master: ${state.ciRun.url}`)
  }

  if (!state.pagesRun) {
    failures.push(`No successful GitHub Pages deploy was found for origin/master at ${state.masterHead.slice(0, 7)}.`)
  } else {
    passes.push(`GitHub Pages deploy passed: ${state.pagesRun.url}`)
  }

  if (!state.supabaseRun) {
    failures.push(`No successful Supabase assistant deploy was found for origin/master at ${state.masterHead.slice(0, 7)}.`)
  } else {
    passes.push(`Supabase assistant deploy passed: ${state.supabaseRun.url}`)
  }

  if (!state.liveSiteContainsVersion) {
    failures.push(
      `The live site at ${state.pagesUrl} is not serving version ${state.version} from ${state.assetUrl ?? 'its current bundle'}.`,
    )
  } else {
    passes.push(`Live site bundle ${state.assetUrl} contains version ${state.version}.`)
  }

  if (state.mergedLocalTopicBranches.length > 0) {
    failures.push(`Merged local topic branches still exist: ${state.mergedLocalTopicBranches.join(', ')}.`)
  } else {
    passes.push('No merged local codex branches remain.')
  }

  if (state.mergedRemoteTopicBranches.length > 0) {
    failures.push(`Merged remote topic branches still exist: ${state.mergedRemoteTopicBranches.join(', ')}.`)
  } else {
    passes.push('No merged remote codex branches remain.')
  }

  return {
    failures,
    passes,
    ok: failures.length === 0,
  }
}
