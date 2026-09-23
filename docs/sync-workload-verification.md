# Database workload verification

KAN-321 compares the actual v0.2.165 application (`97b372d237a0c1ee737a668754475f84d7c166a6`)
with accepted v0.2.170 (`4f6fd2a03367c958c0219fea87ccf71fa374931f`).
The verification release changes only evidence, automation and documentation.

## Comparable browser scenario

`e2e/sync-workload.spec.ts` runs the same application scenario and HTTP/Broadcast
fixture on both revisions: one Chromium client, 20 tasks and 100 inactive Activity
records; startup and Tasks navigation; a fresh Dashboard/Tasks revisit; ten
simulated visible-idle minutes; then one missed task change reconciled on foreground.
The fake clock advances in 40 fifteen-second steps so it does not skip the old
polling cadence. Both clients render the recovered task and serve the fresh revisit
without another account read.

| Account-read measure | v0.2.165 | v0.2.170 |
| --- | ---: | ---: |
| HTTP requests | 49 | 10 |
| Uncompressed response-body bytes | 251,526 | 21,628 |
| Idle version checks in ten minutes | 40 | 1 |
| Full-account snapshots | 2 | 0 |
| Scoped snapshots | 0 | 3 |
| Failed account-read requests/responses | 0 | 0 |

This is 79.6% fewer account reads and 91.4% fewer response-body bytes in this
specific controlled scenario. The missed-change path uses three small requests
instead of two requests including a full snapshot. Local mocked HTTP median
timings were 2.54 ms and 2.93 ms; these are harness observations, **not production
latency measurements**. No daily personal-account, database-query or Disk IO
reduction follows from these results. Response bytes exclude headers, TLS and
unrelated application endpoints. Existing 24-hour service-activity counts and
approximately 17-hour SQL statistics are not comparable denominators.

Run with `npm run test:e2e -- e2e/sync-workload.spec.ts`. The attached JSON records
every measured endpoint, trigger, collection scope, status and byte count.
`HELM_WORKLOAD_SOURCE_COMMIT` labels the source; `HELM_WORKLOAD_OUTPUT` optionally
writes that bounded synthetic receipt to an explicit artifact path. For another
comparison, replay the identical spec and fixture on both exact source revisions
with each revision's locked dependencies; retain their hashes and timestamps.

## Deployed frontend proof

The existing protected post-deploy acceptance workflow runs
`scripts/verify-hosted-frontend-sync.ts`. It waits for Pages to serve the expected
release and byte-identical app JavaScript built from the protected source. Real
Chromium contexts then use disposable synthetic Auth fixtures against the deployed
frontend and backend. The receipt distinguishes immediate same-account updates,
offline/reconnect recovery, account isolation and rehydration; fixture revocation
and removal are required. This is separate from the mocked workload comparison
and hosted SDK-only checks. It does not prove physical Windows/Mac devices or
personal-account behavior. Only a passing exact-deployment receipt proves live
acceptance.

Existing focused polling, recovery and page-loading tests cover hidden/offline
suppression, exhausted retries, missed/duplicate/out-of-order events, stale replies
and account changes. Unchanged prayer/reminder behavior retains the existing
browser and unit gates, including its page-open notification/banner boundary.

## Remaining operational uncertainty

The authorized 22 September restart reset the postmaster window to 20:58:48 UTC.
Analytics ingestion subsequently timed out with SQLSTATE 57014 at 21:00:55 UTC.
Later successful synthetic checks do not erase that failure or establish its root
cause. Resource snapshots, dashboard gaps and current error categories must be
reported separately with their actual windows; missing IO data is not zero.

Always-open clients can retain older JavaScript. The existing release check reloads
a visible, safe page only when there are no queued writes, open dialogs or editable
text. Version-labelled analytics proves received events, not universal client
uptake. An old tab that still displays an earlier version should be reloaded once
after saving its work. Never disrupt an unsaved personal session to manufacture proof.
