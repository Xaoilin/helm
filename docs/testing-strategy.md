# Risk-Matched Test Portfolio

Sabah One uses a small portfolio selected by consequence and boundary fidelity, not test count or coverage percentage. KAN-252 replaced the previous authored test tree atomically: the released candidate must always contain the unit, real-database, and assembled-browser layers described here.

## Gates

- `npm run agent:fast` is the focused developer gate. It runs policy first, then only the lint, type, unit, or browser checks implied by the changed files.
- `npm run check` is the complete local web gate. After policy passes, lint, typecheck, unit tests, web build, and blocking browser tests run as one timed group.
- `npm run test:database` is the complete local database boundary. It starts from the historical migration boundary, applies the authoritative migration chain, and exercises the account/RLS, revision, legacy, and Vault contracts against Postgres.
- GitHub Actions is the release authority. The stable aggregate checks remain `agent-policy`, `database`, `lint`, `typecheck`, `unit`, `e2e`, `build`, and `codex-review`. The risk-matched unit and browser portfolios each run once; exact-tree receipt verification remains unchanged.

The focused and complete gates are intentionally different claims. A green focused gate does not prove the complete web candidate, and a green mocked/unit check does not prove Postgres, browser, deployment, or live behavior.

## Risk To Check Map

| Consequence protected | Cheapest faithful check | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Signed-in data must fail closed | Focused boot/persistence checks plus a browser boot failure | Shared providers and writes remain unavailable without a valid online account session. | Hosted auth expiry, reconnect timing, or production availability. |
| Accounts and revisions must not cross | Transactional local Postgres contract | RLS ownership, account-scoped records, atomic revision/conflict handling, and idempotent mutation identity. | Current remote schema identity; that is release/deployment evidence. |
| Chat and voice must share one mutation path | Source/runtime contract around the shared planner/executor boundary | Both adapters reach one validated execution path and confirmation boundary. | Hosted model quality or every domain mutation. |
| Calendar identity remains account -> source -> event | Focused domain/provider identity examples | Account-scoped source keys and event identity cannot collapse across providers. | Live Google OAuth or provider sync. |
| Prayer dates, deadlines, and reminders use schedule time | Pure policy checks with explicit instants and fake time, plus one browser prayer state | Timetable validation, IANA conversion, exclusive deadlines, overnight Isha, reminder expiry, and visible schedule rendering. | Closed-page delivery, browser throttling, or third-party timetable availability. |
| Settings remain correctly partitioned and persistent | Codec/context checks plus a reload journey | Shared versus device-only fields round-trip through the intended record boundary and a visible choice survives reload. | Remote write acknowledgement for every setting. |
| Core navigation and one user journey remain usable | Small assembled browser portfolio | Boot, Night Compass, navigation, one shared mutation/reload, prayer state, and settings persistence work together in Chromium. | Every surface, responsive width, accessibility mode, or integration. |
| Build and release policy remains fail closed | `agent-policy`, web build, stable CI jobs, and exact-tree receipt checks | The hosted-web pipeline keeps every required aggregate gate and promotes only the tested tree. | A live release until deployment and browser version checks pass. |

## Determinism Rules

- Use explicit UTC instants and named IANA zones; never depend on the host time zone.
- Use fake clocks for timer-driven unit behavior and Playwright clock control for assembled time behavior.
- Isolate storage, routes, ports, users, and database rows per check. Database assertions use transactions and rollback where possible.
- Synchronize on an observable state. Arbitrary sleeps, `page.waitForTimeout`, assertion-only retries, and CI-only retry dependence are forbidden.
- Keep doubles purposeful and retain a real Postgres or browser check where simulation would hide the consequential boundary.
- Failures must identify the violated contract and relevant identity rather than only reporting an implementation call count.

## Replacement And Timing Receipt

Baseline tree `ef9e20abe66113331c42de731b2d0d0e100f36b3` contained 128 authored files: 106 under `src/test`, 17 under `e2e`, and 5 under `supabase/tests`.

Three same-host warm `npm run check` attempts were measured before replacement. One passed in 36.02 seconds; two failed in unrelated browser cases after 33.84 and 34.41 seconds. Because the old portfolio could not provide three successful comparable samples, KAN-252 uses the accepted v0.2.110 local receipt of 35.2 seconds as its labelled historical comparison, as allowed by the ticket.

The candidate contains 19 authored files: 9 under `src/test`, 5 under `e2e`, and 5 under `supabase/tests`. The warm replacement samples before the final complete gate were:

| Boundary | Three successful samples | Median |
| --- | --- | --- |
| Unit | 1.49s, 1.11s, 1.10s | 1.11s |
| Browser E2E | 7.3s, 7.3s, 7.2s | 7.3s |
| Database, engine already warm | 54.38s, 50.33s, 49.95s | 50.33s |
| `agent:fast` | 7.58s, 7.62s, 7.58s | 7.58s |

The unit, E2E, and database gates were also run with deliberate representative faults. Workflow operations `4690e698-a7af-44bc-a1f3-e4b24bc38687`, `e756979f-39ae-412a-af33-73d1185eef13`, and `bf674255-54cd-440d-8470-63c3805eff8e` each rejected its broken check; every probe was then removed or restored before the candidate was frozen.

The final three-run `npm run check` table and accepted source CI elapsed time are release receipts and are added only after those exact candidate runs exist.

## Known Unproven Behavior

This portfolio does not claim exhaustive surface coverage, every responsive or accessibility state, live Google/OpenAI/AlAdhan availability, browser notification delivery after the page closes, production-scale concurrency, or usability outside the recorded browser journey. Those claims require their own boundary evidence.
