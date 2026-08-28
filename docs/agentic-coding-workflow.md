# Agentic Coding Workflow

This document records the current automation policy for Sabah One. The product is a hosted GitHub Pages website, so the authoritative feedback loop is the repository's branch, pull-request, CI, deployment, and live-observation path.

## Policy

1. Start each change on a dedicated `codex/*` branch and state its ownership, dependencies, evidence, and stopping conditions.
2. Keep the smallest coherent change that can falsify the requested outcome. Preserve unrelated work and stop on unexpected overlap or tree drift.
3. Pull-request checks cover policy, database contracts, lint, typecheck, unit tests, browser E2E, and the web build. Visual browser review supplies evidence for rendered claims.
4. The exact tested tree is the candidate. A newer or different tree must not inherit an earlier check result.
5. Protected `master` promotion verifies the tested tree before GitHub Pages or Supabase Edge Function deployment.
6. Post-promotion verification compares the deployed website, `public/release.json`, required function state, and source candidate before the change is called live.
7. Automated review is an additional guard: unavailable provider output is reported as advisory, while completed high-severity findings remain blocking.

This workflow keeps delivery evidence separate from browser behavior evidence and from user-outcome claims. A green check proves only the path it exercises.

## Feedback Contract

The repository automation owns the exact check commands, browser fixtures, artifact identity, and workflow receipts. Documentation should name the evidence boundary rather than prescribe an alternate way to run the product.

The policy scanner keeps these contracts visible:

- source and deployed manifest versions stay aligned;
- changed documentation describes the hosted web runtime;
- shared dates use the established local-date-safe helpers;
- CI keeps stable required job names, exact-tree verification, and review fallback behavior;
- deployment cannot publish a candidate whose database or Supabase function prerequisite is missing.

## Sabah One Inventory MCP

Sabah One has one narrow MCP boundary for cross-project Inventory planning. Live records and actions come from the authenticated `sabah-one-inventory-mcp` Supabase Edge Function; the private planning integration supplies repeatable project-chat behavior. The MCP does not expose generic app state, Secrets, finance, calendars, chats, settings, or broad mutations.

Supabase OAuth 2.1 with PKCE and per-client Sabah One approval controls access. RLS and dedicated Inventory RPCs enforce the boundary. Production enablement remains fail-closed until the hosted OAuth handshake, consent, and revocation paths are evidenced.

## Performance Evidence

Measure GitHub Actions workflow duration and Pages deployment latency from timestamped receipts. Keep web build, unit, browser E2E, deployment, and user-perceived browser behavior as separate measures. Do not infer speed, reliability, or user value from job count or one successful run.

The relevant evidence record includes source revision, workflow run, artifact identity, deployment target, observed website version, and the time window. Revisit budgets when the hosted workflow, browser fixtures, or deployment shape changes materially.

## Sources

- [OpenAI Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- [OpenAI Codex hooks](https://developers.openai.com/codex/hooks)
- [OpenAI Codex GitHub Action](https://github.com/openai/codex-action)
- [OpenAI harness engineering](https://openai.com/index/harness-engineering/)
- [OpenAI Codex PR review cookbook](https://developers.openai.com/cookbook/examples/codex/build_code_review_with_codex_sdk)
- [Anthropic Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Anthropic Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [GitHub Copilot cloud agent best practices](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results)
- [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub GITHUB_TOKEN workflow-trigger behavior](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs)
