# CI performance receipts

Measured on 2026-07-29 after the faster agent and CI workflow landed.

| Gate | Result | Target |
| --- | ---: | ---: |
| Representative warm `npm run agent:fast` | 4.70s | ≤12s |
| Full local `npm run check` median | 25.5s | ≤32s |
| Standalone local Vitest | 9.9s | ≤10s |
| Standalone local blocking E2E | 21.5s | ≤22s |
| Hosted Vitest shards | 22s / 20s | ≤30s each |
| Hosted blocking E2E samples | 49s / 63s | ≤60s p50 |
| Cached native test steps, macOS / Windows | 12s / 14s | ≤15s each |
| Cold native test steps, macOS / Windows | 77s / 198s | recorded separately |

The former full local gate was about 65 seconds, so the current 25.5-second
median is approximately 61% faster.

Hosted receipts:

- [Native-enabled source CI](https://github.com/Xaoilin/helm/actions/runs/30472474396)
- [Sharded-unit source CI](https://github.com/Xaoilin/helm/actions/runs/30473633033)
- [Successful exact-tree receipt](https://github.com/Xaoilin/helm/actions/runs/30474006814)

`agent:fast` is the iteration command; `check` is the one full local gate.
GitHub Actions remains final cross-platform validation. Typed Playwright
scenarios, Debug diagnostics, Tauri IPC contracts, and native tests cover the
current agent interaction needs. Reconsider custom MCP tooling only if measured
interaction setup exceeds 20% of task time.

Documentation plus synchronized release-version metadata is the frontend-only
acceptance case: the stable `native` check must pass while the macOS and Windows
native matrix jobs are skipped.
